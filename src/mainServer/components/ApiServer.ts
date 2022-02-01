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
	private readonly server: ExpressFramework.Express;
	private readonly mainWorkerServer: MainWorkerServer;
	private readonly distributor: Distributor;

	runServer(port: number): void {
		Logger.enterLog(`[ApiServer] Запуск сервера на порту ${port}`, LogLevel.INFO);
		this.server.listen(port);
	}

	constructor(
		mainWorkerServer: MainWorkerServer,
		distributor: Distributor
	){
		this.distributor = distributor;
		this.mainWorkerServer = mainWorkerServer;
		this.server = ExpressFramework();
		
		this.server.use(BodyParser.json());
		//this.Server.use(BodyParser.urlencoded());

		this.server.get(`/`, async (req, res) =>{
			res.statusCode = 200; res.end();
		});
		
		this.server.post(`/`, async (req, res) => {
			const jsonData: unknown | null = req.body;
			res.statusCode = 200;
			res.end();
		});


		this.server.get(`/distribution/dirsCount`, async (req, res) =>{
			res.write((await this.distributor.getDirsCount()).toString());
			res.statusCode = 200; res.end();
		});

		this.server.get('/distribution/getServersList', async (req, res) => {
			res.write(this.distributor.getServersList().join(","));
			res.statusCode = 200; res.end();
		});

		this.server.get(`/distribution/count`, async (req, res) =>{
			const param = req.query["distributed"];

			if (typeof(param) === "undefined"){
				res.write("Param distributed:1or0 is undefined");
				res.statusCode = 200; res.end();
				return;
			}

			if (param == "1"){
				res.write(this.distributor.getDistributedCount().toString());
			} else {
				res.write(this.distributor.getNotDistributedCount().toString());
			}

			res.statusCode = 200; res.end();
		});

		this.server.get(`/distribution/checkDistribution`, async (req, res) =>{
			this.distributor.checkDistribution();
			res.statusCode = 200; res.end();
		});

		this.server.get(`/distribution/checkNetworkIntegrity`, async (req, res) =>{
			let fix = false;
			let fullCheck = false;

			if (req.query["fixErrors"] == "1"){
				fix = true;
			}

			if (req.query["fullCheck"] == "1"){
				fullCheck = true;
			}

			this.distributor.checkNetworkIntegrity(fix, fullCheck);
			res.statusCode = 200; res.end();
		});

		this.server.get(`/distribution/startAutoDistrib`, async (req, res) =>{
			/**
			 * Загрузка директорий и проверка распределения будет произведена, если список не распределенных директорий пуст
			 */
			
			this.distributor.runAutoDistrib({
				loadDirs: (this.distributor.getNotDistributedCount() == 0),
				checkDistribution: (this.distributor.getNotDistributedCount() == 0)
			});

			res.statusCode = 200; res.end();
		});
		
		this.server.get(`/distribution/runReDistribution`, async (req, res) =>{
			this.distributor.runReDistribution();
			res.statusCode = 200; res.end();
		});

		this.server.get('/distribution/updateServerList', async (req, res) => {
			res.write(this.distributor.updateServersList().toString());
			res.statusCode = 200; res.end();
		})

		this.server.get('/distribution/loadDirs', async (req, res) => {
			this.distributor.loadDirs(undefined, true);
			res.statusCode = 200; res.end();
		})




		
		this.server.get('/getLag', async (req, res) => {
			const start = new Date()
			setTimeout(() => {
				const lag = ((new Date().getMilliseconds()) - start.getMilliseconds());
				
				res.write(lag.toString());
				res.statusCode = 200; res.end();
			})
		});

		this.server.get('/serversList', async (req, res) => {
			const servers = this.mainWorkerServer.workerManager.getServers();
			const data: any[] = [];

			for (const server of servers){
				data.push({
					id: server.id,
					url: server.url,
					port: server.port,
					cpu_count: server.cpu_count,
					dirsCount: server.dirsCount
				});
			}

			res.write(JSON.stringify(data));
			res.statusCode = 200; res.end();
		});
	}
}

export {
	ApiServer
};