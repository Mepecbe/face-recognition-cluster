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

/**Сборщик статистики для Prometheus */
export class StatsManager {
	/**Веб-сервер */
	private readonly server: ExpressFramework.Express;

	/**======= WEB SERVERS REQUESTS STATS =======*/

	/**web req path - count */
	private requests: Map<string, number> = new Map();
	private requestsMutex: Mutex = new Mutex();

	private incomingWebTraffic = 0;
	private outcomingWebTraffic = 0;
	private webTrafficSizeMutex: Mutex = new Mutex();

	/**==========================================*/


	/**Зарегистрировать обращение к серверу по HTTP */
	async regRequest(path: string): Promise<void> {
		this.requestsMutex.runExclusive(() => {
			const count = (this.requests.get(path) || 0) + 1;
			this.requests.set(path, count);
		})
	}

	/**Добавляет или обнуляет метрику по счету количества запросов на путь веб сервера(не обязательно, regRequest это может сделать автоматом)*/
	createPathMetrics(path: string): void {
		this.requests.set(path, 0);
	}

	/**
	 * Зарегистрировать трафик
	 * @param size Размер в байтах
	 * @param type Тип трафика(вход/исход)
	 * */
	async regTraffic(size: number, type: "incoming" | "outcoming"): Promise<void> {
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
	public runServer(port: number): void {
		Logger.enterLog(`[StatsManager] Запуск сервера на порту ${port}`, LogLevel.INFO);
		this.server.listen(port);
	}

	constructor(){
		this.server = ExpressFramework();
		this.server.use(BodyParser.json());
		
		this.server.get(`/metrics`, async (req, res) =>{

			//Данные о HTTP запросах на API сервер системы
			await this.requestsMutex.runExclusive(() => {
				let data = "";

				for (const r of this.requests){
					data += `main_api_server_requests {path="${r[0]}"} ${r[1]}\n`
					this.requests.set(r[0], 0);
				}

				if (data.length == 0){
					data += `main_api_server_requests {path="/"} 0\n`
				}

				res.write(data);
			});

			//Данные о размере трафика
			await this.webTrafficSizeMutex.runExclusive(() => {
				let data = `traffic {type="in"} ${this.incomingWebTraffic}\n`;
				data += `traffic {type="out"} ${this.outcomingWebTraffic}\n`;
				this.incomingWebTraffic = 0;
				this.outcomingWebTraffic = 0;
				res.write(data);
			});

			res.statusCode = 200; res.end();
		});
	}
}