import * as fs from "fs";
import { Logger, LogLevel } from "../../../Logger";

/**Информация о сервере(какие папки на нём размещены) */
export type serverStorageInfo = {
	serverId: string;
	dirs: string[];
}

/**Хранилище информации о файлах(где и на каких серверах размещена папка) */
export interface FileInfoStorage {
	/**Загрузить данные */
	loadData(): serverStorageInfo[];
	/**Сохранить данные */
	saveData(data: serverStorageInfo[]): void
}

export class FileStorage implements FileInfoStorage {
	private dbFile: string;

	loadData(): serverStorageInfo[] {
		const data = JSON.parse(fs.readFileSync(this.dbFile).toString());
		const resp: serverStorageInfo[] = [];

		if (Array.isArray(data)){
			for (const el of data){
				const dirs: string[] = [];

				if (!Array.isArray(el.dirs)){
					continue;
				} else {
					for (const dir of el.dirs){
						dirs.push(dir);
					}
				}

				resp.push({
					serverId: el.serverId,
					dirs
				});
			}
		}

		return resp;
	}

	saveData(data: serverStorageInfo[]): void {
		fs.writeFileSync(this.dbFile, JSON.stringify(data));
	}
	
	constructor(
		dbFile: string
	){
		this.dbFile = dbFile;

		if (!fs.existsSync(this.dbFile)){
			Logger.enterLog(`[FileStorage] Create ${this.dbFile}`, LogLevel.WARN);
			fs.writeFileSync(this.dbFile, "[]");
		}
	}
}