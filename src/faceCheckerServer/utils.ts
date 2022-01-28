import * as fs from "fs";

export class Utils {
	/**
	 * input - 123sdf
	 * output - 123sdf.jpg
	 */
	static getFullFilename(filename: string, dir: string): {
		found: boolean,
		file: string
	} {
		const list = fs.readdirSync(dir);

		for (const el of list){
			if (el.split(".")[0] == filename){
				return {
					found: true,
					file: el
				}
			}
		}

		return {
			found: false,
			file: ""
		}
	}
}