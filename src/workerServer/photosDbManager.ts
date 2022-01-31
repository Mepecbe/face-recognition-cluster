import * as fs from "fs";
import { Logger, LogLevel } from "../Logger";
import * as CRC32 from "crc-32";

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
	
	/**Проверить, есть ли в списке такая папка с фотографиями */
	checkExistsDir(dir: string): boolean {
		for (const d of this.photosDirectories){
			if (d[1] == dir){
				return true;
			}
		}

		return false;
	}

	/**Удалить директорию с фотографиями
	 * если dir - пусто, то удалить всё
	 */
	rmDir(dir: string): void {
		if (dir.length == 0){
			fs.rm(this.PHOTOS_DIR, {
				recursive: true
			}, (err) => {
				if (err){
					Logger.enterLog(`Ошибка удаления всех папок, код ${err.code}`, LogLevel.WARN);
				}
			})

			return;
		}

		if (this.checkExistsDir(dir)){
			fs.rm(this.PHOTOS_DIR + dir, {
				recursive: true
			}, (err) => {
				if (err){
					Logger.enterLog(`Ошибка удаления директории >${this.PHOTOS_DIR + dir}<, код ${err.code}`, LogLevel.WARN);
				}
			})
		}
	}
	
	/**Проверить, есть ли такая фотография 
	 * @param dir Директория фотографии
	 * @param photo Наименование фотографии(вместе с расширением)
	 * @param checksumm Возвращать ли контрольную сумму
	 * @example checkPhoto("qwerty", "123.jpg", true)
	 * @returns 0 - если файл не существует, иначе значение отличное от нуля
	*/
	checkPhoto(dir: string, photo: string, checksumm: boolean): number {
		if(this.checkExistsDir(dir)) {
			if (fs.existsSync(this.PHOTOS_DIR + dir + "/" + photo)){
				if (checksumm){
					return CRC32.buf(fs.readFileSync(this.PHOTOS_DIR + dir + "/" + photo), 0);
				} else {
					return 1;
				}
			}
		}
		
		return 0;
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
			if (!fs.existsSync(this.PHOTOS_DIR)){
				Logger.enterLog(`Create ${this.PHOTOS_DIR}`, LogLevel.WARN);
				fs.mkdirSync(this.PHOTOS_DIR, undefined);
			}

			const dirs = fs.readdirSync(this.PHOTOS_DIR);

			if (dirs.length != this.photosDirectories.size){
				Logger.enterLog(`Updated directories list, old count ${this.photosDirectories.size}, new ${dirs.length}`, LogLevel.INFO);

				this.photosDirectories.clear();

				for (let index = 0; index < dirs.length; index++){
					this.photosDirectories.set(index, dirs[index]);
				}
			}
		}, 5000);

		Logger.enterLog(`[PhotosManager] Loaded ${dirs.length} directories`, LogLevel.INFO);
	}
}