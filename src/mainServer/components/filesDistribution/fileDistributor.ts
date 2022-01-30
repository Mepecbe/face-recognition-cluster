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
	private readonly PHOTOS_DIRECTORY: string;
	private server: MainWorkerServer;
	private storage: FileInfoStorage;

	//Идентификатор сервера - папки загруженные на него
	private filesDb: Map<string, string[]> = new Map();

	//Не распределенные по серверам папки
	private notDistributedDirs: string[] = [];

	/**Получить количество директорий */
	async getDirsCount(): Promise<number> {
		return new Promise((resolve, reject) => {
			fs.readdir(this.PHOTOS_DIRECTORY, (err, result) => {
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

	/**Обновить список серверов */
	updateServersList(): number {
		const servers = this.server.workerManager.getServers();

		for (const s of servers){
			if (!this.filesDb.has(s.id)){
				this.filesDb.set(s.id, []);
			}
		}

		return this.filesDb.size;
	}

	/**Загрузить список директорий находящихся на этом сервере и поместить список не распределенных */
	async loadDirs(callback?: () => void, log = true): Promise<void> {
		fs.readdir(this.PHOTOS_DIRECTORY, undefined, async (err, result) => {
			if (err){
				Logger.enterLog(`[loadDirs] Ошибка загрузки директорий ${err}`, LogLevel.ERROR);
			}

			let counter = 0;

			let bar: progress.SingleBar | undefined = undefined;

			if (log){
				Logger.blockMessages(true);

				bar = new progress.SingleBar({
					format: 'Загрузка папок |' + ansiColors.cyan('{bar}') + '| {percentage}% || {value}/{total} ',
					barCompleteChar: '\u2588',
					barIncompleteChar: '\u2591',
					hideCursor: true
				});
				bar.start(result.length, 0);
			}

			for(const r of result){
				if (bar){
					bar.increment();
				}
				
				if (this.notDistributedDirs.includes(r)){
					continue;
				}

				counter++;
				this.notDistributedDirs.push(r);
				
				if (counter % 1000 == 0){
					//Что бы сервер не "задохнулся"
					await timeout(100);
				}
			}

			if (bar){
				bar.stop();
				Logger.blockMessages(false);
			}


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
	checkDistribution(log: boolean): void {
		if (this.filesDb.size == 0){
			Logger.enterLog(`[checkDistibutedDirs] Проверка распределения не будет проведена, так как список серверов с информацией распределения пуст`, LogLevel.WARN);
			return;
		}

		Logger.blockMessages(true);
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
				Logger.enterLog(`WARN! Unknown error ${dir}`, LogLevel.ERROR);
				continue;
			}

			const locationSearchResult = this.getDirLocation(dir);

			if(!locationSearchResult.is_success){
				this.notDistributedDirs.unshift(dir);
			} else {
				//сервер, на котором расположена директория найден, обратно в список добавлять не требуется
			}
		}
		
		bar.stop();
		Logger.blockMessages(false);
		Logger.enterLog(`Проверка распределения завершена, не распределено ${this.notDistributedDirs.length} папок`, LogLevel.INFO)
	}

	/**Проверить целостность папок */
	async checkNetworkIntegrity(): Promise<void> {
		if (this.filesDb.size == 0){
			Logger.enterLog(`[checkNetworkIntegrity] Проверка целостности сети прервана(серверов нет)`, LogLevel.WARN);
			return;
		} else {
			Logger.enterLog(`[checkNetworkIntegrity] Начинаю проверку целостности сети`, LogLevel.WARN);
		}

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

	/**Запустить автоматическое распределение */
	async runAutoDistrib(
		params: {
			loadDirs: boolean,
			checkDistibution: boolean
		}
	): Promise<void> {
		if (params.loadDirs){
			await this.loadDirs();
		}

		if (params.checkDistibution){
			this.checkDistribution(true);
		}

		if (this.notDistributedDirs.length == 0){
			Logger.enterLog(`[autoDistrib] Распределение файлов остановлено, нет не распределенных директорий`, LogLevel.WARN);
			return;
		}

		const countDirsPerServer = Math.floor(this.notDistributedDirs.length / this.filesDb.size);

		Logger.enterLog(`[autoDistrib] Старт распределения, всего папок для распределения ${this.notDistributedDirs.length}, количество доступных серверов ${this.filesDb.size}, на один сервер приходится ${countDirsPerServer} файлов`, LogLevel.WARN);

		for (const serverFiles of this.filesDb){
			const serverInfo = this.server.workerManager.getServer(serverFiles[0]);

			if (serverInfo.is_success){
				const bar = new progress.SingleBar({
					format: `Распределение файлов на сервер ${serverInfo.data.url}:${serverInfo.data.port} | ${ansiColors.cyan('{bar}')}| {percentage}% || {value}/{total} {dir}`,
					barCompleteChar: '\u2588',
					barIncompleteChar: '\u2591',
					hideCursor: true
				});

				Logger.blockMessages(true);
				bar.start(countDirsPerServer, 0);

				//Количество успешно загруженых файлов
				let filesUploaded = 0;

				//Количество загрузок файлов с ошибками
				let filesUploadError = 0;

				//Директории, которые не получилось выгрузить
				let dirsUploadErrors: string[] = [];

				//Загрузка части файлов, предназначенной для этого сервера
				for (let counter = countDirsPerServer; counter > 0; counter--){
					const dir = this.notDistributedDirs.pop();

					if (!dir){
						continue;
					}

					const filesList = fs.readdirSync(this.PHOTOS_DIRECTORY + dir);

					if (filesList.length > 0){
						let errors = 0;

						for (const f of filesList){
							const uploadImageResult = await serverInfo.data.uploadImage(this.PHOTOS_DIRECTORY + dir + "/" + f, dir);

							if (uploadImageResult.is_success){
								filesUploaded++;
							} else {
								errors++;
								continue;
							}
						}

						filesUploadError += errors;

						if (errors > 0){
							//Если хотя бы 1 файл не получилось выгрузить - папка считается не распределенной
							dirsUploadErrors.push(dir);
							continue;
						} else {
							serverFiles[1].push(dir);
						}
					} else {
						const createDirResult = await serverInfo.data.createDir(dir);

						if (!createDirResult.is_success){
							dirsUploadErrors.push(dir);
							continue;
						} else {
							serverFiles[1].push(dir);
						}
					}

					bar.increment(1, {
						dir
					});
				}

				this.filesDb.set(serverFiles[0], serverFiles[1]);

				bar.stop();
				Logger.blockMessages(false);

				Logger.enterLog(`На сервер ${serverInfo.data.url}:${serverInfo.data.port} отправлено ${filesUploaded} файлов, не отправлено ${filesUploadError}`, LogLevel.INFO);
				
				if (dirsUploadErrors.length != 0){
					if (dirsUploadErrors.length < 10){
						Logger.enterLog(`Не удалось выгрузить ${dirsUploadErrors.join(',')} папок`, LogLevel.WARN);
					} else {
						Logger.enterLog(`Список не выгруженных папок слишком велик!`, LogLevel.WARN);
					}
				}
			} else {
				Logger.enterLog(`[autoDistrib] Информация о сервере не найдена, srv id ${serverFiles[0]}`, LogLevel.WARN);
			}
		}

		Logger.enterLog(`[autoDistrib] Новые данные о распределении сохранены`, LogLevel.WARN);
		this.saveDb();
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
			checkDistribution: boolean,
			updateServersList: boolean
		}
	) {
		this.server = server;
		this.storage = new FileStorage(process.env.DISTRIBUTOR_DB_FILE || "distrib.db");
		this.PHOTOS_DIRECTORY = process.env.PHOTOS_DIRECTORY || "images/";

		if (settings.loadDb){
			this.loadDb();
			
			let allDirs = 0;
			for (const s of this.filesDb){
				allDirs += s[1].length;
			}

			Logger.enterLog(`[fileDistibutor] Загружена информация о директориях на серверах, записей о серверах ${this.filesDb.size}, суммарно папок на удалённых серверах ${allDirs}`, LogLevel.INFO);
		}

		if (settings.loadDirs){
			if (settings.checkDistribution){
				Logger.enterLog(`[fileDistibutor] Начинаю загрузку директорий с последующей проверкой на основании сохранённых данных`, LogLevel.INFO); 
				this.loadDirs(() => { 
					Logger.enterLog(`[fileDistibutor] Загружено директорий ${this.notDistributedDirs.length}! Запускаю проверку распределения папок(сверка с данными из базы)`, LogLevel.INFO); 
					this.checkDistribution(true);
				});
			} else {
				Logger.enterLog(`[fileDistibutor] Начинаю загрузку директорий без проверки распределения`, LogLevel.INFO); 
				this.loadDirs(() => { 
					Logger.enterLog(`[fileDistibutor] Загружено директорий ${this.notDistributedDirs.length}!`, LogLevel.INFO);
				});
			}
		}

		if (settings.updateServersList){
			this.updateServersList();
		}
	}
}