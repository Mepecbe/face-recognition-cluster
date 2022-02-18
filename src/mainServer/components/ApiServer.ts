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
import * as multer from "multer";
import * as fs from "fs";
import { StatsManager } from './statsCollector';


/**API сервер для взаимодействия с подключаемыми внешними сервисами*/
class ApiServer{
	private readonly statsManager: StatsManager;
	private readonly server: ExpressFramework.Express;
	private readonly mainWorkerServer: MainWorkerServer;
	private readonly distributor: Distributor;
	private readonly temporaryFilesDir: string;

	/**
	 * Запустить HTTP сервер
	 * @param port Порт сервера
	 */
	runServer(port: number): void {
		Logger.enterLog(`[ApiServer] Запуск сервера на порту ${port}`, LogLevel.INFO);
		this.server.listen(port);
	}

	constructor(
		statsManager: StatsManager,
		mainWorkerServer: MainWorkerServer,
		distributor: Distributor,
		temporaryFilesDir: string
	){
		this.statsManager = statsManager;
		this.distributor = distributor;
		this.mainWorkerServer = mainWorkerServer;
		this.temporaryFilesDir = temporaryFilesDir;
		this.server = ExpressFramework();

		this.server.use((req, res, next) => {
			//INCOMING TRAFFIC SIZE
			this.statsManager.regRequest(req.path);
			this.statsManager.regTraffic(req.socket.bytesRead, "incoming");

			if (req.file){
				this.statsManager.regTraffic(req.file.size, "incoming");
			}


			next();
		});

		this.server.use((req, res, next) => {
			//OUTCOMING TRAFFIC SIZE
			this.statsManager.regRequest(req.path);
			this.statsManager.regTraffic(req.socket.bytesWritten, "outcoming");

			next();
		});
		
		this.server.use(multer( { dest: this.temporaryFilesDir } ).single("filedata"));
		this.server.use(BodyParser.json());

		this.server.get(`/`, async (req, res) =>{
			res.statusCode = 200; res.end();
		});
		
		this.server.post(`/`, async (req, res) => {
			res.statusCode = 200; res.end();
		});

		/**============================ РАСПРЕДЕЛЕНИЕ ============================= */

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
				res.statusCode = 400; res.end();
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
			// Загрузка директорий и проверка распределения будет произведена, если список не распределенных директорий пуст

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
			res.write(
				(await this.distributor.updateServersList(req.query["active"] == "1")).toString()
				);
			res.statusCode = 200; res.end();
		})

		this.server.get('/distribution/clearDistributionInfo', async (req, res) => {
			this.distributor.clearInfo();
			res.statusCode = 200; res.end();
		})

		this.server.get('/distribution/loadDirs', async (req, res) => {
			this.distributor.loadDirs(undefined, true);
			res.statusCode = 200; res.end();
		})



		/**============================ СЕРВЕРНЫЕ УТИЛИТЫ ============================= */

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

		/**=============================== ОСНОВНЫЕ КОМАНДЫ ========================================= */

		this.server.post('/createTask', async (req, res) => {
			const filedata = req.file;

			if (!filedata){
				res.write("filedata is undefined");
				res.statusCode = 400; res.end();
				return;
			}
			
			Logger.enterLog(`[/createTask] Received data ${(filedata.size / 1024).toFixed(2)} KBytes`, LogLevel.WARN);

			fs.rename(
				`${this.temporaryFilesDir}/${filedata.filename}`,
				`${this.temporaryFilesDir}/${filedata.filename}.${filedata.originalname.split(".")[1]}`,
				async (err) => {
					if (err){
						Logger.enterLog(
							`Возникла ошибка при переименовании файла ${this.temporaryFilesDir}/${filedata.filename} в ${this.temporaryFilesDir}/${filedata.filename}.${filedata.originalname.split(".")[1]}, код ошибки ${err.code}`, 
							LogLevel.ERROR
						);

						res.statusCode = 500; res.end();
					} else {
						const createTaskResult = await this.mainWorkerServer.addTaskToPool(`${filedata.filename}.${filedata.originalname.split(".")[1]}`, 0);
						
						if (!createTaskResult.is_success){
							Logger.enterLog(`Ошибка добавления задачи в пулл задач код ${createTaskResult.error.message}`, LogLevel.ERROR);
							res.statusCode = 500;
							res.write(createTaskResult.error.message);
						} else {
							res.statusCode = 200;
						}

						res.end();
					}
				}
			);
		});

		this.server.get('/taskResult', async (req, res) => {
			if (typeof(req.query["taskId"]) !== "string" || typeof(req.query["found"]) !== "string"){
				res.write(`Bad param "taskId" or "found"`);
				res.write(400); res.end();
				return;
			}

			if (req.query["found"] == "1"){
				if (typeof(req.query["faceId"]) != "string"){
					res.write(`Bad param "taskId" or "found"`);
					res.write(400); res.end();
					return;
				}
			}

			Logger.enterLog(`Задача ${req.query["taskId"]} завершена, результат ${req.query["found"]}`, LogLevel.WARN);

			this.mainWorkerServer.taskUpdate(req.query["taskId"], req.query["found"] == "1", req.query["faceId"]?.toString());
		});
	}
}

export {
	ApiServer
};