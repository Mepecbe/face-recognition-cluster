import * as ExpressFramework from "express";
import * as BodyParser from "body-parser";
import {
	RequestOptions,
	RgWeb,
	ErrorCodes as WebErrorCodes
} from 'rg-web';
import { Request } from 'express';
import { Logger, LogLevel } from '../../Logger';
import { Mutex } from "async-mutex";
import { MainWorkerServer } from "./mainWorkerServer";
import * as os from "os";
import * as osUtils from "os-utils";
import * as diskInfo from "diskspace";
import { Result } from "diskspace";

/**Сборщик статистики для Prometheus */
export class StatsManager {
	/**Веб-сервер */
	private readonly server: ExpressFramework.Express;

	/**======= WEB SERVERS REQUESTS STATS =======*/

	/**web req path - count */
	private static requests: Map<string, number> = new Map();
	private static requestsMutex: Mutex = new Mutex();

	private static incomingWebTraffic = 0;
	private static outcomingWebTraffic = 0;
	private static webTrafficSizeMutex: Mutex = new Mutex();

	private mainWorkerServer: MainWorkerServer | undefined;

	/**==========================================*/


	/**
	 * Зарегистрировать обращение к серверу по HTTP
	 * */
	 static async regRequest(path: string): Promise<void> {
		this.requestsMutex.runExclusive(() => {
			const count = (this.requests.get(path) || 0) + 1;
			this.requests.set(path, count);
		})
	}

	/**
	 * Добавляет или обнуляет метрику по счету количества запросов на путь веб сервера(не обязательно, regRequest это может сделать автоматом)
	 * */
	 static createPathMetrics(path: string): void {
		this.requests.set(path, 0);
	}

	/**
	 * Зарегистрировать трафик
	 * @param size Размер в байтах
	 * @param type Тип трафика(вход/исход)
	 * */
	static async regTraffic(size: number, type: "incoming" | "outcoming"): Promise<void> {
		this.webTrafficSizeMutex.runExclusive(() => {
			if (type == "incoming"){
				this.incomingWebTraffic += size;
			} else {
				this.outcomingWebTraffic += size;
			}
		});
	}




	/**
	 * Запустить сервер сбора статистики для Prometheus'a 
	 * */
	public runServer(
		workerServer: MainWorkerServer | undefined,
		port: number
	): void {
		this.mainWorkerServer = workerServer;

		Logger.enterLog(`[StatsManager] Запуск сервера на порту ${port}`, LogLevel.INFO);
		this.server.listen(port);
	}


	constructor(){
		this.server = ExpressFramework();
		this.server.use(BodyParser.json());
		
		this.server.get(`/metrics`, async (req, res) =>{

			//Данные о HTTP запросах на API сервер системы
			await StatsManager.requestsMutex.runExclusive(() => {
				let data = "";

				for (const r of StatsManager.requests){
					data += `main_api_server_requests {path="${r[0]}"} ${r[1]}\n`
					StatsManager.requests.set(r[0], 0);
				}

				if (data.length == 0){
					data += `main_api_server_requests {path="/"} 0\n`
				}

				res.write(data);
			});

			//Данные о размере трафика
			await StatsManager.webTrafficSizeMutex.runExclusive(() => {
				let data = `traffic {type="in"} ${StatsManager.incomingWebTraffic}\n`;
				data += `traffic {type="out"} ${StatsManager.outcomingWebTraffic}\n`;
				StatsManager.incomingWebTraffic = 0;
				StatsManager.outcomingWebTraffic = 0;
				res.write(data);
			});

			//Данные главного управляющего сервера и сети в целом
			if (this.mainWorkerServer != undefined){
				let data = `search_face_tasks_count{type="active"} ${this.mainWorkerServer.tasksPool.length}\n`;
				data += `search_face_tasks_count{type="completed"} ${this.mainWorkerServer.completedTasks.length}\n`;
				res.write(data);
			
				//Данные удалённых серверов
				{
					const serversList = this.mainWorkerServer.workerManager.getServers();
					let destinationServersData = ``;

					for(const srv of serversList){
						if ((await srv.checkConnection()).is_success){
							const tasks = await srv.getTasksCount();
							const cpuUsage = await srv.getCpuUsage();
							const ramUsage = await srv.getRamInfo();

							if (tasks.is_success){
								destinationServersData += `tasks_count{server="${srv.url}"} ${tasks.data}\n`;
							}

							if (cpuUsage.is_success){
								destinationServersData += `cpu_usage{srv_type="worker" url="${srv.url}"} ${cpuUsage.data}\n`;
							}

							if (ramUsage.is_success){
								destinationServersData += `ram_usage{srv_type="worker" url="${srv.url}" ptype="total"} ${ramUsage.data.total/1000000}\n`;
								destinationServersData += `ram_usage{srv_type="worker" url="${srv.url}" ptype="used"} ${ramUsage.data.used/1000000}\n`;
							}
						}
					}

					res.write(`servers_count{type="workers"} ${serversList.length}\n`);
					res.write(destinationServersData);
				}

				//Информация по директориям
				{
					res.write(`dirs{type="distributed"} ${this.mainWorkerServer.distributor.getDistributedCount()}\n`);
					res.write(`dirs{type="notDistributed"} ${this.mainWorkerServer.distributor.getNotDistributedCount()}\n`);
					res.write(`dirs{type="on_hdd"} ${await this.mainWorkerServer.distributor.getDirsCount()}\n`); 
					res.write(`dirs{type="loaded"} ${this.mainWorkerServer.distributor.getNotDistributedCount()+this.mainWorkerServer.distributor.getDistributedCount()}\n`);
				}
			}

			//Общие данные
			{
				//Использование оперативной памяти процессом в Мегабайтах
				const memUsage = process.memoryUsage();
				res.write(`main_server_memory_usage{type="rss"} ${memUsage.rss/1000000}\n`);
				res.write(`main_server_memory_usage{type="arrayBuffers"} ${memUsage.arrayBuffers/1000000}\n`);
				res.write(`main_server_memory_usage{type="external"} ${memUsage.external/1000000}\n`);
				res.write(`main_server_memory_usage{type="heapTotal"} ${memUsage.heapTotal/1000000}\n`);
				res.write(`main_server_memory_usage{type="heapUsed"} ${memUsage.heapUsed/1000000}\n`);

				//Информация об использовании оперативной памяти СЕРВЕРА в общем
				res.write(`ram_usage{srv_type="main" ptype="total"} ${os.totalmem()/1000000}\n`);
				res.write(`ram_usage{srv_type="main" ptype="used"} ${(os.totalmem() - os.freemem())/1000000}\n`);


				//Процессор
				const cpuUsage = await new Promise<number>((resolve) => { osUtils.cpuUsage((usage) => {
					resolve(usage);
				})});

				res.write(`cpu_usage{srv_type="main"} ${cpuUsage * 100}\n`);

				//Дисковое пространство
				const diskUsage = await new Promise<Result | undefined>((resolve) => { diskInfo.check("/", (err, result) => {
					if (err){
						resolve(undefined);
					} else {
						resolve(result);
					}
				})});

				if (diskUsage){
					res.write(`main_server_disk{type="used"} ${(diskUsage.used/parseInt(diskUsage.total)) * 100}\n`);
				}
			}


			res.statusCode = 200; res.end();
		});
	}
}