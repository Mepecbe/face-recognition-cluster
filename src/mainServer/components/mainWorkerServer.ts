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
import { Distributor } from "./filesDistribution/fileDistributor";


/**Главный сервер, служит для связи и общения с другими серверами, которые занимаются поиском лица */
export class MainWorkerServer{
	private readonly Server: ExpressFramework.Express;

	//Менеджер серверов
	public workerManager: WorkersManager;

	public distributor: Distributor;

	//Пул задач сети
	public tasksPool: SearchFaceTask[] = [];

	/**Управляет загрузкой серверов задачами */
	private poolManager: NodeJS.Timer;

	//Папка с фотографиями для задач
	readonly imagesDir: string;

	private getTaskById(id: string): SearchFaceTask | null {
		for (const t of this.tasksPool){
			if (t.id == id){
				return t;
			}
		}

		return null;
	}

	/**
	 * Добавить задачу в пул
	 * @param photo Файл фотографии
	 * @param priority Приоритет задачи
	 * @returns Если успешно - идентификатор новой задачи
	 */
	public async addTaskToPool(photo: string, priority = 0): Promise<RgResult<string>> {
		return new Promise((resolve, reject) => {
			fs.exists(this.imagesDir, async (result) => {
				if (!result){
					resolve({
						is_success: false,
						error: {
							code: 1,
							message: `File ${photo} not found`
						}
					});
				}

				const newTask: SearchFaceTask = {
					id: uuid.v4(),
					sourcePhoto: photo,
					uploadedPhotosId: new Map(),
					priority,
					inQueue: this.distributor.getAllDistributedDirs(),
					completed: [],
					inProcess: [],
					found: []
				};

				const servers = this.workerManager.getServers();

				if (servers.length == 0){
					resolve({
						is_success: false,
						error: {
							code: 2,
							message: `Service list is empty`
						}
					});
				} else {
					for (const server of servers){
						const uploadResult = await server.getImageId(this.imagesDir + photo);
						Logger.enterLog(`[addTaskToPoll] Загрузка фотографии ${photo} на сервер ${server.url}:${server.port}`, LogLevel.INFO);
	
						if (uploadResult.is_success){
							Logger.enterLog(`       Успех`, LogLevel.INFO);
							newTask.uploadedPhotosId.set(server.id, uploadResult.data);
						} else {
							Logger.enterLog(`       Ошибка! ${uploadResult.error.message}`, LogLevel.WARN);
						}
					}
	
					this.tasksPool.push(newTask);
	
					Logger.enterLog(`Создана новая задача ${newTask.id}, приоритет ${priority}, всего в пуле задач ${this.tasksPool.length}`, LogLevel.INFO);
	
					resolve({
						is_success: true,
						data: newTask.id
					});
				}
			})
		})
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
		workersManager: WorkersManager,
		distrib: Distributor,
		imagesDir: string
	){
		this.Server = ExpressFramework();
		this.Server.use(BodyParser.json());
		//this.Server.use(BodyParser.urlencoded());

		this.workerManager = workersManager;
		this.distributor = distrib;
		this.imagesDir = imagesDir;

		this.poolManager = setInterval(async () => {
			if (this.tasksPool.length == 0){
				return;
			}

			const servers = this.workerManager.getServers();

			for (const task of this.tasksPool){
				if (task.inQueue.length > 0){
					Logger.enterLog(`  [poolManager] Обработка задачи ${task.id}`, LogLevel.INFO);

					const dir = task.inQueue.pop();

					if (dir){
						const searchResult = this.distributor.getDirLocation(dir);

						if (searchResult.is_success){
							const server = this.workerManager.getServer(searchResult.data);

							if (server.is_success){
								const serverPhotoId = task.uploadedPhotosId.get(server.data.id);

								if (serverPhotoId){
									Logger.enterLog(`    Создание задачи на сервере ${server.data.id}`, LogLevel.INFO);
									const createTaskResult = await server.data.createServerTask(serverPhotoId, dir);

									if (createTaskResult.is_success){
										Logger.enterLog(`      Задача создана, идентификатор ${createTaskResult.data}`, LogLevel.INFO);

										task.inProcess.push({
											taskId: createTaskResult.data,
											dir
										});
									} else {
										Logger.enterLog(`      Ошибка создания задачи -> ${createTaskResult.error.message}`, LogLevel.WARN);
									}
								} else {
									Logger.enterLog(`    Фотография задачи не была выгружена на сервер ${server.data.id}`, LogLevel.WARN);
								}
							} else {
								Logger.enterLog(`    Сервер, на котором расположена директория ${dir} не найден`, LogLevel.WARN);
							}
						} else {
							Logger.enterLog(`    Директория ${dir} для задачи не найдена`, LogLevel.WARN);
							task.inQueue.unshift(dir);
						}
					}
				} else {
					//Нет папок для проверки
				}
			}

			for (const server of servers){
				const dirs = await server.getDirs();

				if (dirs.is_success){
					
				}
			}
		}, 100);

		//Connection checker
		this.Server.get(`/`, async (req, res) =>{
			res.statusCode = 200;
			res.end();
		});

		this.Server.post(`/`, async (req, res) => {
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
	}
}