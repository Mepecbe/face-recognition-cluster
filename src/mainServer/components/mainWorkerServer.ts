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
import * as progress from "cli-progress";
import * as ansiColors from "ansi-colors";
import { Mutex } from "async-mutex";
import { CreateTaskErrors } from "../../workerErrors";


/**Главный сервер, служит для связи и общения с другими серверами, которые занимаются поиском лица */
export class MainWorkerServer{
	private readonly Server: ExpressFramework.Express;

	//Менеджер серверов
	public workerManager: WorkersManager;

	public distributor: Distributor;

	//Пул активных задач сети по идентификации лица
	public tasksPool: SearchFaceTask[] = [];
	
	//Пул завершенных задач сети по идентификации лица
	public completedTasks: SearchFaceTask[] = [];

	/**Управляет загрузкой серверов задачами */
	private poolManager: NodeJS.Timer;

	//Папка с фотографиями для задач
	readonly imagesDir: string;

	/**
	 * Получить задачу ПОИСКА ЛИЦА по айди
	 * @param id Идентификатор задачи
	 * @returns Задача по поиску лица в случа успеха
	 */
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
					mutex: new Mutex(),
					sourcePhoto: photo,
					uploadedPhotosId: new Map(),
					priority,
					inQueue: this.distributor.getAllDistributedDirs(),
					completed: [],
					inProcess: [],
					errorStart: [],
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
	
						if (uploadResult.is_success){
							Logger.enterLog(`[addTaskToPoll] Загружена фотография ${photo} на сервер ${server.url}:${server.port}`, LogLevel.INFO);
							newTask.uploadedPhotosId.set(server.id, uploadResult.data);
						} else {
							Logger.enterLog(`[addTaskToPoll] Ошибка загрузки фотографии ${photo} на сервер ${server.url}:${server.port}`, LogLevel.ERROR);
						}
					}
	
					this.tasksPool.push(newTask);
	
					Logger.enterLog(`Создана новая задача ${newTask.id}, приоритет ${priority}, всего в пуле задач ${this.tasksPool.length}`, LogLevel.INFO);
	
					resolve({
						is_success: true,
						data: newTask.id
					});
				}
			});
		});
	}

	/**
	 * Обновить состояние задачи
	 * @param taskId Идентификатор задачи
	 * @param found Найдено ли лицо
	 * @param foundDir Директория в которой найдено лицо
	 */
	public async taskUpdate(taskId: string, found: boolean, foundDir?: string): Promise<void> {
		if (found && foundDir == undefined){
			Logger.enterLog(`[taskUpdate] Ошибка обновления, лицо найдено но директория с лицом не указана!`, LogLevel.ERROR);
			return;
		}
		
		for (const searchFaceTask of this.tasksPool){
			searchFaceTask.mutex.runExclusive(() => {
				let taskFound = false;

				for (let index = 0; index < searchFaceTask.inProcess.length; index++){
					if (searchFaceTask.inProcess[index].taskId == taskId){
						const completedTask = searchFaceTask.inProcess[index];

						searchFaceTask.inProcess.splice(index, 1);

						if (found){
							searchFaceTask.found.push(completedTask.dir);
						} else {
							searchFaceTask.completed.push(completedTask.dir);
						}

						taskFound = true;

						Logger.enterLog(`Задача ${taskId} обновлена! В очереди задач ${searchFaceTask.inQueue.length}, выполняется ${searchFaceTask.inProcess.length}, выполнено ${searchFaceTask.completed.length}`, LogLevel.INFO);

						break;
					}
				}

				if (!taskFound){
					Logger.enterLog(`ВНИМАНИЕ! Завершенная задача не была найдена ${taskId}`, LogLevel.WARN);
					console.log(searchFaceTask);
				}
			});
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

			for (let taskIndex = 0; taskIndex < this.tasksPool.length; taskIndex++){
				const task = this.tasksPool[taskIndex];

				if (task.mutex.isLocked()){
					continue;
				}

				await task.mutex.acquire();

				if (task.inProcess.length == 0 && task.inQueue.length == 0){
					//Задача по поиску лица выполнена
					Logger.enterLog(`Задача по поиску лица ${task.id} выполнена, ${task.found.length > 0 ? `найденые лица ${task.found.join(',')}` : `лицо не идентифицированно`}, ошибок исполнения ${task.errorStart.length}`, LogLevel.INFO);
					this.tasksPool.splice(taskIndex);
					this.completedTasks.push(task);
					task.mutex.release();
					continue;
				}

				//Если есть задачи которые необходимо поставить в очередь
				if (task.inQueue.length > 0){
					Logger.enterLog(`  [poolManager] Обработка задачи ${task.id}`, LogLevel.INFO);
					Logger.blockMessages(true);

					const bar = new progress.SingleBar({
						format: `Загрузка задач на удалённые сервера | ${ansiColors.cyan('{bar}')} | {percentage}% || ${ansiColors.green('{value}')}/${ansiColors.red('{errors}')}/{total} `,
						barCompleteChar: '\u2588',
						barIncompleteChar: '\u2591',
						hideCursor: true
					});

					bar.start(task.inQueue.length, 0, {
						errors: task.errorStart.length
					});

					while (task.inQueue.length > 0){
						const dir = task.inQueue.pop();

						if (dir){
							//Поиск директории в сети серверов
							const searchResult = this.distributor.getDirLocation(dir);

							if (searchResult.is_success){
								//Если директория успешно найдена
								const server = this.workerManager.getServer(searchResult.data);

								if (server.is_success){
									const serverPhotoId = task.uploadedPhotosId.get(server.data.id);

									if (serverPhotoId){
										//Создание задачи на удаленном сервере
										const createTaskResult = await server.data.createServerTask(serverPhotoId, dir);

										if (createTaskResult.is_success){ 
											//Задача создана, идентификатор createTaskResult.data
											bar.increment(1, {
												errors: task.errorStart.length
											});

											task.inProcess.push({
												taskId: createTaskResult.data,
												dir
											});
										} else {
											if (createTaskResult.error.code == CreateTaskErrors.DIRECTORY_EMPTY){
												task.completed.push(dir);

												bar.increment(1, {
													errors: task.errorStart.length
												});
											} else {
												//Серверная ошибка создания задачи
												task.errorStart.push({
													dir,
													code: createTaskResult.error.code
												});
											}
										}
									} else {
										//При создании задачи фотография почему то либо не была выгружена на удаленный сервер, либо была повреждена на удаленном сервере
										task.errorStart.push({
											dir,
											code: CreateTaskErrors.CHECK_IMAGE_NOT_UPLOADED
										});
									}
								} else {
									//Сервер не активен
									task.errorStart.push({
										dir,
										code: CreateTaskErrors.SERVER_OFFLINE
									});
								}
							} else {
								//Директория в сети серверов не была найдена, рекомендуется провести проверку целостности
								task.errorStart.push({
									dir,
									code: CreateTaskErrors.NETWORK_DIRECTORY_NOT_FOUND
								});
							}
						} else {
							//Нет папок для проверки
						}

						bar.increment(0, {
							errors: task.errorStart.length
						});
					}

					bar.stop();
					Logger.blockMessages(false);
				}

				task.mutex.release();
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
			if (typeof(req.query["taskId"]) != "string"){
				res.write(`param taskId is undefined`);
				res.statusCode = 400; res.end();
				return;
			}

			if (typeof(req.query["found"]) != "string"){
				res.write(`param found is undefined`);
				res.statusCode = 400; res.end();
			} else {
				if (req.query["found"] == "1"){
					if (typeof(req.query["faceId"]) !== "string"){
						res.write(`param faceId is undefined`);
						res.statusCode = 400; res.end();
						return;
					} else {
						this.taskUpdate(req.query["taskId"], true, req.query["found"]);
						res.statusCode = 200; res.end();
					}
				} else {
					this.taskUpdate(req.query["taskId"], false);
					res.statusCode = 200; res.end();
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
				Logger.enterLog(`Сервер не добавлен, плохой запрос, ${DESTINATION_SERVER_URL}:${DESTINATION_SERVER_PORT}, CPUs ${DESTINATION_SERVER_CPU_COUNT}, dirs ${DESTINATION_SERVER_DIRS_COUNT}`, LogLevel.WARN);
				res.statusCode = 400;
				res.end();
				return;
			}

			if (this.workerManager.existsServer(
				DESTINATION_SERVER_URL, 
				parseInt(DESTINATION_SERVER_PORT),
				parseInt(DESTINATION_SERVER_CPU_COUNT))
			){
				Logger.enterLog(`Сервер не добавлен(уже в списке), ${DESTINATION_SERVER_URL}:${DESTINATION_SERVER_PORT}, CPUs ${DESTINATION_SERVER_CPU_COUNT}, dirs ${DESTINATION_SERVER_DIRS_COUNT}`, LogLevel.WARN);
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

			Logger.enterLog(`Добавлен новый сервер, ${DESTINATION_SERVER_URL}:${DESTINATION_SERVER_PORT}, CPUs ${DESTINATION_SERVER_CPU_COUNT}, dirs ${DESTINATION_SERVER_DIRS_COUNT}`, LogLevel.INFO);

			res.statusCode = 200;
			res.end();
		});
	}
}