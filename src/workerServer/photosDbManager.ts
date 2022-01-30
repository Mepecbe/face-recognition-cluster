import * as fs from "fs";
import { Logger, LogLevel } from "../Logger";

export class PhotosManager {
	readonly updater: NodeJS.Timer;
	readonly PHOTOS_DIR: string;
	/**номер порядковый - наименование папки */
	private photosDirectories: Map<number, string> = new Map();

	getFirstDir(): string {
		return this.photosDirectories.get(0) || "";
	}

	getAllDir(): string[] {
		return Array.from(this.photosDirectories.values());
	}
	
	checkExistsDir(dir: string): boolean {
		if (fs.existsSync(this.PHOTOS_DIR + dir)){
			return true;
		}

		return false;
	}

	constructor(){
		this.PHOTOS_DIR = process.env.PHOTOS_DIRECTORY || "images/";
		if (!this.PHOTOS_DIR.endsWith("/")){
			this.PHOTOS_DIR += "/";
		}

		if(!fs.existsSync(this.PHOTOS_DIR)){
			Logger.enterLog(`[PhotosManager] Create photos directory ${this.PHOTOS_DIR}`, LogLevel.WARN);
			fs.mkdir(this.PHOTOS_DIR, undefined, (callback) => {});
		}

		const dirs = fs.readdirSync(this.PHOTOS_DIR);
		
		for (let index = 0; index < dirs.length; index++){
			this.photosDirectories.set(index, dirs[index]);
		}

		this.updater = setInterval(() => {
			const dirs = fs.readdirSync(this.PHOTOS_DIR);

			if (dirs.length != this.photosDirectories.size){
				Logger.enterLog(`Updated directories list, old count ${this.photosDirectories.size}, new ${dirs.length}`, LogLevel.INFO);

				for (let index = 0; index < dirs.length; index++){
					this.photosDirectories.set(index, dirs[index]);
				}
			}
		}, 5000);

		Logger.enterLog(`[PhotosManager] Loaded ${dirs.length} directories`, LogLevel.INFO);
	}
}