import { RgResult } from "rg";
import * as ping from "node-http-ping";
import { Logger, LogLevel } from "../../Logger";
import * as request from "request";
import { RgWeb} from "rg-web";

export class WorkerServer {
	public readonly id: string;
	public readonly url: string;
	public readonly port: number;
	public readonly cpu_count: number;
	public readonly dirsCount: number;
	public pingLatency: number;
	public tasksCount: number;
	public dirs: string[];
	public readonly client: RgWeb;

	public async checkConnection(): Promise<RgResult<number>> {
		try{
			const result = await ping(this.url, this.port);
			this.pingLatency = result;
			
			return {
				is_success: true,
				data: result
			}
		} catch(Ex: any) {
			this.pingLatency = -1;

			return {
				is_success: false,
				error: {
					code: parseInt(Ex),
					message: `Check connection error, code ${Ex}`
				}
			}
		}
	}

	public async getTasksCount(): Promise<RgResult<number>> {
		const result = await this.client.request({
			path: "/getTasksCount",
			method: "GET",
			port: this.port
		}, null);

		if (result.is_success){
			this.tasksCount = parseInt(result.data);

			return {
				is_success: true,
				data: parseInt(result.data)
			}
		}

		return result;
	}

	/**Получить список директорий на сервере */
	public async getDirs(): Promise<RgResult<string[]>>{
		const result = await this.checkConnection();
		if (result.is_success){
			const result = await this.client.request({
				path: `/getDirList`,
				method: "GET"
			}, null)

			if (result.is_success){
				this.dirs = result.data.split(',');

				return {
					is_success: true,
					data: this.dirs
				}
			} else {
				return result;
			}
		} else {
			return {
				is_success: false,
				error: {
					code: 1,
					message: `Check connection error`
				}
			}
		}
	}

	public async dirExists(dir: string): Promise<RgResult<number>> {
		const result = await this.checkConnection();
		if (result.is_success){
			const result = await this.client.request({
				path: `/checkDir?dir=${dir}`,
				method: "GET"
			}, null)

			if (result.is_success){
				return {
					is_success: true,
					data: parseInt(result.data)
				}
			} else {
				return result;
			}
		} else {
			return {
				is_success: false,
				error: {
					code: 1,
					message: `Check connection error`
				}
			}
		}
	}

	constructor(
		id: string,
		url: string,
		port: number,
		cpuCount: number,
		dirsCount: number
	){
		this.id = id;
		this.url = url;
		this.port = port;
		this.cpu_count = cpuCount;
		this.dirsCount = dirsCount;
		this.pingLatency = 0;
		this.tasksCount = 0;
		this.dirs = [];
		this.client = new RgWeb(this.url, this.port, "HTTP");
		
		this.checkConnection().then(result => {
			if (!result.is_success){
				Logger.enterLog(`Ошибка проверки соединения с добавленным сервером ${url}:${port}`, LogLevel.ERROR)
			}
		});
	}
}