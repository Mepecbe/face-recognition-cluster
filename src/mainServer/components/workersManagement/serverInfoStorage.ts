import * as fs from "fs";
import { Logger, LogLevel } from "../../../Logger";

/**Запись в файловом хранилище(информация о сервере) */
export type storageRecord = {
	id: string;
	url: string;
	port: number;
	cpu_count: number;
	dirs: number;
}

/**Хранилище информации о серверах */
export interface IServersInfoStorage {
	loadAll(): storageRecord[];
	saveAll(records: storageRecord[]): void;
}

/**Файловое хранилище информации */
export class FileServersInfoStorage implements IServersInfoStorage {
	public readonly dbFile: string;

	loadAll(): storageRecord[] {
		const data = JSON.parse(fs.readFileSync(this.dbFile).toString());
		const records: storageRecord[] = [];

		if (Array.isArray(data)){
			for (const element of data){
				if (typeof(element.id) !== "string"){
					continue;
				}
				
				if (typeof(element.url) !== "string"){
					continue;
				}
				
				if (typeof(element.port) !== "number"){
					continue;
				}
				
				if (typeof(element.cpu_count) !== "number"){
					continue;
				}
				
				if (typeof(element.dirs) !== "number"){
					continue;
				}

				records.push(element);
			}
		}

		return records;
	}

	saveAll(records: storageRecord[]): void {
		fs.writeFileSync(
			this.dbFile,
			JSON.stringify(records.map((el) => {
				return {
					id: el.id,
					url: el.url,
					port: el.port,
					cpu_count: el.cpu_count,
					dirsCount: el.dirs
				}
			})
		))
	}
	
	constructor (
		dbFile: string
	) {
		this.dbFile = dbFile;
		
		if (!fs.existsSync(this.dbFile)){
			Logger.enterLog(`[WorkersManager] Create file ${this.dbFile}`, LogLevel.WARN);
			fs.appendFileSync(this.dbFile, "");
		}
	}
}