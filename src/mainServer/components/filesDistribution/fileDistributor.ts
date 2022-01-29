import { MainWorkerServer } from "../mainWorkerServer";
import { WorkerServer } from "../types";
import * as fs from "fs";
import { Logger, LogLevel } from "../../../Logger";
import { FileInfoStorage, FileStorage } from "./filesInfoStorage";
import { RgResult } from "rg";
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

	/**Загрузить директории находящиеся на сервере и поместить список не распределенных */
	async loadDirs(callback?: () => void): Promise<void> {
		fs.readdir(process.env.PHOTOS_DIRECTORY || "images/", undefined, (err, result) => {
			if (err){
				Logger.enterLog(`[loadDirs] Ошибка загрузки директорий ${err}`, LogLevel.ERROR);
			}

			let counter = 0;

			const bar = new progress.SingleBar({
				format: 'Проверка распределения папок |' + ansiColors.cyan('{bar}') + '| {percentage}% || {value}/{total} ',
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
			}

			bar.stop();

			console.log(`[loadDirs] Загружено ${result.length} директорий, из них ${counter} не распределены, всего не распределенных ${this.notDistributedDirs.length}`);

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

	/**Проверка распределения файлов
	 * Проверяет каждую папку на наличие её на определенном сервере
	 * Если папка существует на каком-либо сервере, то она удаляется из списка не распределенных папок
	 */
	checkDistibutedDirs(log: boolean): void {
		for(let index = 0; index < this.notDistributedDirs.length; index++){
			const dir = this.notDistributedDirs.pop();

			if (!dir){
				continue;
			}

			const result = this.getDirLocation(dir);

			if(!result.is_success){
				this.notDistributedDirs.unshift(dir);

				if (log){
					Logger.enterLog(`[checkDistributedDirs] ${dir} -> NO DISTRIBUTED`, LogLevel.INFO);
				}
			} else {
				if (log){
					Logger.enterLog(`[checkDistributedDirs] ${dir} -> DISTRIBUTED ${result.data}`, LogLevel.INFO);
				}
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

	constructor(
		server: MainWorkerServer,
		loadDb: boolean,
		loadDirs: boolean,
		checkDistributed: boolean
	) {
		this.server = server;
		this.storage = new FileStorage(process.env.DISTRIBUTOR_DB_FILE || "distrib.db");

		if (loadDb){
			this.loadDb();
			Logger.enterLog(`[fileDistibutor] Загружена информация о директориях на серверах, записей ${this.filesDb.size}`, LogLevel.INFO)
		}

		if (loadDirs){
			if (checkDistributed){
				Logger.enterLog(`[fileDistibutor] Начинаю загрузку директорий с последующей проверкой на основании сохранённых данных`, LogLevel.INFO); 
				this.loadDirs(() => { 
					Logger.enterLog(`[fileDistibutor] Загружено директорий ${this.notDistributedDirs.length}! Запускаю проверку распределения папок`, LogLevel.INFO); 
					this.checkDistibutedDirs(true);
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