import { 
	RgResult,
	RgSuccess,
	Event,
	format,
	RgError,
	timeout,
	Colors
} from 'rg';

import * as ExpressFramework from "express";
import * as BodyParser from "body-parser";

import {
	RequestOptions,
	RgWeb,
	ErrorCodes as WebErrorCodes
} from 'rg-web';

import { stringify } from 'uuid';
import { Request } from 'express';
import { Logger, LogLevel } from '../../Logger';
import 'dotenv/config';
import { MainWorkerServer } from './mainWorkerServer';
import { Distributor } from './filesDistribution/fileDistributor';

/**API сервер для взаимодействия с подключаемыми внешними сервисами*/
class ApiServer{
	private readonly Server: ExpressFramework.Express;
	private readonly mainWorkerServer: MainWorkerServer;
	private readonly distributor: Distributor;

	runServer(port: number): void {
		Logger.enterLog(`[ApiServer] Запуск сервера на порту ${port}`, LogLevel.INFO);
		this.Server.listen(port);
	}

	constructor(
		mainWorkerServer: MainWorkerServer,
		distributor: Distributor
	){
		this.distributor = distributor;
		this.mainWorkerServer = mainWorkerServer;
		this.Server = ExpressFramework();
		
		this.Server.use(BodyParser.json());
		//this.Server.use(BodyParser.urlencoded());

		this.Server.get(`/`, async (req, res) =>{
			res.statusCode = 200;
			res.end();
		});
		
		this.Server.get(`/`, async (req, res) =>{
			res.statusCode = 200;
			res.end();
		});


		this.Server.post(`/`, async (req, res) => {
			const jsonData: unknown | null = req.body;
			res.statusCode = 200;
			res.end();
		});
	}
}

export {
	ApiServer
};