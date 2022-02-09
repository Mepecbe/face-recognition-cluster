import { Logger, LogLevel } from "../../Logger";
import * as ExpressFramework from "express";
import * as BodyParser from "body-parser";
import { SearchFaceTask, WorkerServer } from "./types";
import { RgResult } from "rg";
import { Utils } from "./utils";
import request = require("request");
import * as fs from "fs";
import { WorkersManager } from "./workersManagement/workersManager";
import * as uuid from "uuid";


/**Главный сервер, служит для связи и общения с другими серверами, которые занимаются поиском лица */
export class MainWorkerServer{
	private readonly Server: ExpressFramework.Express;

	//Менеджер серверов
	public workerManager: WorkersManager;

	//Пул задач
	public tasksPool: SearchFaceTask[] = [];

	private getTaskById(id: string): SearchFaceTask | null {
		for (const t of this.tasksPool){
			if (t.id == id){
				return t;
			}
		}

		return null;
	}

	/**Создать задачу по поиску лица на сервере
	 * @param fileId Идентификатор ранее загруженного на сервер файла
	 * @param server Сервер, который будет осуществлять поиск
	 * @param dirname Наименование папки, в которой будет осуществлятся поиск
	 * @returns Идентификатор созданной задачи
	 */
	public async createTask(fileId: string, server: WorkerServer, dirname: string): Promise<RgResult<string>>{
		const result = await server.checkConnection();
		if (result.is_success){
			const result = await server.client.request({
				path: `/createTask?fileid=${fileId}&directory=${dirname}`,
				method: "GET"
			}, null)

			if (result.is_success){
				return {
					is_success: true,
					data: result.data
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


	/**
	 * Запустить главный управляющий сервер
	 * @argument port Порт для приёма информации от воркеров
	 */
	runServer(port: number): void {
		Logger.enterLog(`[MainWorkerServer] Запуск управляющего сервера на порту ${port}`, LogLevel.INFO);
		this.Server.listen(port);
	}


	constructor(
		workersManager: WorkersManager
	){
		this.Server = ExpressFramework();
		this.Server.use(BodyParser.json());
		//this.Server.use(BodyParser.urlencoded());

		this.workerManager = workersManager;

		//Connection checker
		this.Server.get(`/`, async (req, res) =>{
			res.statusCode = 200;
			res.end();
		});

		this.Server.get(`/taskResult`, async (req, res) => {
			if (typeof(req.query["taskid"]) != "string"){
				res.write(`param taskId is undefined`);
				res.statusCode = 400; res.end();
				return;
			}

			const task = this.getTaskById(req.query["taskid"]);

			if (!task){
				Logger.enterLog(`Внимание! Завершенная задача ${req.query["taskid"]} не была найдена в пуле`, LogLevel.WARN);
				res.statusCode = 400; res.end();
			} else {
				task.completed.push()

				if (typeof(req.query["found"]) != "string"){
					res.write(`param found is undefined`);
					res.statusCode = 400; res.end();
				} else {
	
					if (req.query["found"] == "1"){
						if (typeof(req.query["faceId"]) !== "string"){
							res.write(`param faceId is undefined`);
							res.statusCode = 400; res.end();
						} else {
							
						}
					} else {
	
					}
				}
			}
		});

		this.Server.get(`/addServer`, async (req, res) =>{
			const DESTINATION_SERVER_URL = req.query["ip"]?.toString();
			const DESTINATION_SERVER_PORT = req.query["port"]?.toString();
			const DESTINATION_SERVER_DIRS_COUNT = req.query["dirs"]?.toString();
			const DESTINATION_SERVER_CPU_COUNT = req.query["cpuCount"]?.toString();

			if (!DESTINATION_SERVER_CPU_COUNT
				|| !DESTINATION_SERVER_DIRS_COUNT
				|| !DESTINATION_SERVER_URL
				|| !DESTINATION_SERVER_PORT
			){
				Logger.enterLog(`Server not added, ${DESTINATION_SERVER_URL}:${DESTINATION_SERVER_PORT}, CPUs ${DESTINATION_SERVER_CPU_COUNT}, dirs ${DESTINATION_SERVER_DIRS_COUNT}`, LogLevel.WARN);
				res.statusCode = 400;
				res.end();
				return;
			}

			if (this.workerManager.existsServer(
				DESTINATION_SERVER_URL, 
				parseInt(DESTINATION_SERVER_PORT),
				parseInt(DESTINATION_SERVER_CPU_COUNT))
			){
				Logger.enterLog(`Server not added(ALREADY EXISTS), ${DESTINATION_SERVER_URL}:${DESTINATION_SERVER_PORT}, CPUs ${DESTINATION_SERVER_CPU_COUNT}, dirs ${DESTINATION_SERVER_DIRS_COUNT}`, LogLevel.WARN);
				res.statusCode = 201;
				res.end();
				return;
			}

			const id = uuid.v4();
			
			this.workerManager.addServer(
				id,
				DESTINATION_SERVER_URL,
				parseInt(DESTINATION_SERVER_PORT),
				parseInt(DESTINATION_SERVER_CPU_COUNT),
				parseInt(DESTINATION_SERVER_DIRS_COUNT)
			);

			this.workerManager.saveToStorage();

			Logger.enterLog(`Added new server, ${DESTINATION_SERVER_URL}:${DESTINATION_SERVER_PORT}, CPUs ${DESTINATION_SERVER_CPU_COUNT}, dirs ${DESTINATION_SERVER_DIRS_COUNT}`, LogLevel.INFO);

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