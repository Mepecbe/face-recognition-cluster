import { WorkerServer } from "../types";
import * as fs from "fs";
import { Logger, LogLevel } from "../../../Logger";
import { RgResult } from "rg";
import { FileServersInfoStorage, IServersInfoStorage } from "./serverInfoStorage";

export class WorkersManager {
	private servers: WorkerServer[];
	/**Хранилище информации о серверах */
	private storage: IServersInfoStorage;
	private readonly Checker: NodeJS.Timer;

	/**Добавить сервер
	 * @argument id Идентификатор сервера
	 * @argument url Адрес сервера
	 * @argument port Порт сервера
	 * @argument cpuCount Количество ядер процессора
	 * @argument dirs Количество загруженных директорий с фотографиями
	 */
	addServer(
		id: string,
		url: string,
		port: number,
		cpuCount: number,
		dirs: number
	): RgResult<boolean> {
		if (!this.existsServerById(id)){
			this.servers.push(new WorkerServer(
				id,
				url,
				port,
				cpuCount,
				dirs
			));

			return {
				is_success: true,
				data: true
			}
		}

		return {
			is_success: false,
			error: {
				code: 1,
				message: `Server already exists`
			}
		}
	}

	saveToStorage(): void {
		this.storage.saveAll(
			this.servers.map((srv) => {
				return {
					id: srv.id,
					url: srv.url,
					port: srv.port,
					dirs: srv.dirsCount,
					cpu_count: srv.cpu_count
				}
			})
		)
	}

	/**Проверить, есть ли сервер с таким идентификатором */
	existsServerById(id: string): boolean {
		return this.servers.map(s => { return s.id == id; }).includes(true);
	}

	/**Проверить, есть ли сервер с такимими ДАННЫМИ */
	existsServer(url: string, port: number, cpuCount: number): boolean {
		return this.servers.map(
			s => {
				return (s.url == url && s.port == port && s.cpu_count == cpuCount) 
			}
		).includes(true);
	}


	/**Отсеять самый мощный сервер */
	public parseCpuCount(servers: WorkerServer[]): WorkerServer {
		if (servers.length == 0){
			throw new Error("Servers list is empty");
		}

		let w: WorkerServer = servers[0];

		for(let first = 1; first < servers.length; first++){
			for(let second = 1; second < servers.length; second++){
				if (first == second){
					continue;
				}

				if (w.cpu_count < servers[second].cpu_count){
					w = servers[second];
				}
			}
		}

		return w;
	}
	
	/**Отсеять самый не загруженный сервер*/
	public parseTasksCount(): WorkerServer {
		if (this.servers.length == 0){
			throw new Error("Servers list is empty");
		}

		let w: WorkerServer = this.servers[0];

		for(let first = 1; first < this.servers.length; first++){
			for(let second = 1; second < this.servers.length; second++){
				if (first == second){
					continue;
				}

				if (w.tasksCount > this.servers[second].tasksCount){
					w = this.servers[second];
				}
			}
		}

		return w;
	}

	
	/**Чекер серверов(проверяет пинг, загруженность задачами) */
	async serversChecker(): Promise<void> {
		for(const srv of this.servers){
			await srv.checkConnection();
			await srv.getTasksCount();
		}
	}

	constructor(){
		this.servers = [];
		this.storage = new FileServersInfoStorage(process.env.SERVERS_INFO_FILE || "server.db");
		this.Checker = setInterval(
			this.serversChecker.bind(this), 
			parseInt(process.env.SERVER_CHECKER_TIMEOUT || "60") * 1000
		);
	}
}