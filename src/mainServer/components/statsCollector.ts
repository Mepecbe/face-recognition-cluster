import * as ExpressFramework from "express";
import * as BodyParser from "body-parser";
import {
	RequestOptions,
	RgWeb,
	ErrorCodes as WebErrorCodes
} from 'rg-web';
import { Request } from 'express';
import { Logger, LogLevel } from '../../Logger';

/**Сборщик статистики для Prometheus */
export class StatsManager {
	private readonly server: ExpressFramework.Express;
	
	runServer(port: number): void {
		Logger.enterLog(`[StatsManager] Запуск сервера на порту ${port}`, LogLevel.INFO);
		this.server.listen(port);
	}

	constructor(){
		this.server = ExpressFramework();
		this.server.use(BodyParser.json());

		this.server.get(`/`, async (req, res) =>{
			console.log(`req get /`);
			res.statusCode = 200; res.end();
		});
		
		this.server.get(`/metrics`, async (req, res) =>{
			const d = new Date();
			res.write(`avg_load ${d.getSeconds()}`);
			res.statusCode = 200; res.end();
		});

		this.server.post(`/`, async (req, res) => {
			console.log(`req post /`);
			res.statusCode = 200; res.end();
		});
	}
}