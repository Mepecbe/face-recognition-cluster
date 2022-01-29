import { MainWorkerServer } from "../mainWorkerServer";
import { WorkerServer } from "../types";
import * as fs from "fs";
import { Logger, LogLevel } from "../../../Logger";
import { FileInfoStorage, FileStorage } from "./filesInfoStorage";
import { RgResult, timeout } from "rg";
import * as progress from "cli-progress";
import * as ansiColors from "ansi-colors";

/**Основная задача - распределение файлов и папок между серверами */
export class Distributor{
	private server: MainWorkerServer;
	private storage: FileInfoStorage;

	//Идентификатор сервера - папки загруженные на него
	private filesDb: Map<string, string[]> = new Map();

	//Не распределенные по серверам папки
	private notDistributedDirs: string[] = [];

	/**Получить количество директорий */
	async getDirsCount(): Promise<number> {
		return new Promise((resolve, reject) => {
			fs.readdir(process.env.PHOTOS_DIRECTORY || "images/", (err, result) => {
				if (err){
					reject(err);
				} else {
					resolve(result.length);
				}
			})
		})
	}

	/**Получить количество не распределенных файлов */
	getNotDistributedCount(): number {
		return this.notDistributedDirs.length;
	}

	/**Получить сумарное количество распределенных файлов */
	getDistributedCount(): number {
		let count = 0;

		for (const s of this.filesDb){
			count += s[1].length
		}

		return count;
	}

	/**Загрузить список директорий находящихся на этом сервере и поместить список не распределенных */
	async loadDirs(callback?: () => void): Promise<void> {
		fs.readdir(process.env.PHOTOS_DIRECTORY || "images/", undefined, async (err, result) => {
			if (err){
				Logger.enterLog(`[loadDirs] Ошибка загрузки директорий ${err}`, LogLevel.ERROR);
			}

			let counter = 0;

			const bar = new progress.SingleBar({
				format: 'Загрузка папок |' + ansiColors.cyan('{bar}') + '| {percentage}% || {value}/{total} ',
				barCompleteChar: '\u2588',
				barIncompleteChar: '\u2591',
				hideCursor: true
			});

			bar.start(result.length, 0);

			for(const r of result){
				bar.increment();
				if (this.notDistributedDirs.includes(r)){
					continue;
				}

				counter++;
				this.notDistributedDirs.push(r);
				await timeout(1000);
			}

			bar.stop();


			if (callback){
				callback();
			}
		});
	}

	/**Получить местонахождение директории
	 * @returns идентификатор сервера в случае обнаружения
	 */
	getDirLocation(dirName: string): RgResult<string>{
		for (const serverInfo of this.filesDb){
			for (const dir of serverInfo[1]){
				if (dir == dirName){
					return {
						is_success: true,
						data: serverInfo[0]
					}
				}
			}
		}

		return {
			is_success: false,
			error: {
				code: 1,
				message: `Server not found`
			}
		}
	}

	/**Проверка распределения файлов (сверка с данными из базы)
	 * Проверяет каждую папку на наличие её на определенном сервере
	 * Если папка существует на каком-либо сервере, то она удаляется из списка не распределенных папок
	 */
	checkDistibution(log: boolean): void {
		if (this.filesDb.size == 0){
			Logger.enterLog(`[checkDistibutedDirs] Проверка распределения не будет проведена, так как список серверов с информацией распределения пуст`, LogLevel.WARN);
			return;
		}

		const bar = new progress.SingleBar({
			format: 'Проверка распределения папок |' + ansiColors.cyan('{bar}') + '| {percentage}% || {value}/{total} ',
			barCompleteChar: '\u2588',
			barIncompleteChar: '\u2591',
			hideCursor: true
		});

		bar.start(this.notDistributedDirs.length, 0);

		for(let index = 0; index < this.notDistributedDirs.length; index++){
			bar.increment();

			const dir = this.notDistributedDirs.pop();

			if (!dir){
				continue;
			}

			const locationSearchResult = this.getDirLocation(dir);

			if(!locationSearchResult.is_success){
				this.notDistributedDirs.unshift(dir);
			} else {
				//сервер, на котором расположена директория найден, обратно в список добавлять не требуется
			}
		}
	}

	/**Проверить целостность папок */
	async checkNetworkIntegrity(): Promise<void> {
		Logger.enterLog(`[checkNetworkIntegrity] Начинаю проверку целостности сети`, LogLevel.WARN);

		for (const server of this.filesDb){
			const serverInfo = this.server.workerManager.getServer(server[0]);

			if (serverInfo.is_success){
				const bar = new progress.SingleBar({
					format: 'Проверка целостности |' + ansiColors.cyan('{bar}') + '| {percentage}% || {value}/{total} ',
					barCompleteChar: '\u2588',
					barIncompleteChar: '\u2591',
					hideCursor: true
				});

				bar.start(server[1].length, 0);

				const badDirs: string[] = [];

				for (const dir of server[1]){
					const result = await serverInfo.data.dirExists(dir);

					if (!result.is_success){
						badDirs.push(dir);
					}

					bar.increment();
				}
			} else {
				Logger.enterLog(`[checkNetworkIntegrity] Сервер ${server[0]} не найден`, LogLevel.WARN);
			}
		}
	}

	/**Загрузить данные о распределении файлов и папок среди сети серверов из хранилища */
	loadDb(): void {
		this.storage.loadData().map((element) => {
			this.filesDb.set(element.serverId, element.dirs);
		});
	}

	/**Сохранить данные о распределении файлов и папок среди сети серверов в хранилища */
	saveDb(): void {
		this.storage.saveData(Array.from(this.filesDb).map(el => { 
			return {
				serverId: el[0],
				dirs: el[1]
			}
		}));
	}

	/**
	 * 
	 * @param server Главный управляющий сервер
	 * @param loadDb Загружать ли базу с информацией распределения на серверах
	 * @param loadDirs Загружать ли список директорий в список не распределённых
	 * @param checkDistribution Проверять распределение информации на серверах(не реальная проверка, сверка с данными из базы), крайне рекомендуется при каждой загрузке папок
	 */
	constructor(
		server: MainWorkerServer,
		settings: {
			loadDb: boolean,
			loadDirs: boolean,
			checkDistribution: boolean
		}
	) {
		this.server = server;
		this.storage = new FileStorage(process.env.DISTRIBUTOR_DB_FILE || "distrib.db");

		if (settings.loadDb){
			this.loadDb();
			Logger.enterLog(`[fileDistibutor] Загружена информация о директориях на серверах, записей ${this.filesDb.size}`, LogLevel.INFO)
		}

		if (settings.loadDirs){
			if (settings.checkDistribution){
				Logger.enterLog(`[fileDistibutor] Начинаю загрузку директорий с последующей проверкой на основании сохранённых данных`, LogLevel.INFO); 
				this.loadDirs(() => { 
					Logger.enterLog(`[fileDistibutor] Загружено директорий ${this.notDistributedDirs.length}! Запускаю проверку распределения папок(сверка с данными из базы)`, LogLevel.INFO); 
					this.checkDistibution(true);
				});
			} else {
				Logger.enterLog(`[fileDistibutor] Начинаю загрузку директорий без проверки распределения`, LogLevel.INFO); 
				this.loadDirs(() => { 
					Logger.enterLog(`[fileDistibutor] Загружено директорий ${this.notDistributedDirs.length}!`, LogLevel.INFO);
				});
			}
		}
	}
}