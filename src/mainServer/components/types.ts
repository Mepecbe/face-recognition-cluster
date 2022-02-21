import { RgResult } from "rg";
import * as ping from "node-http-ping";
import { Logger, LogLevel } from "../../Logger";
import * as request from "request";
import { RgWeb } from "rg-web";
import * as fs from "fs";
import { Mutex } from "async-mutex";
import { CreateTaskErrors, WorkerRequestError } from "../../workerErrors";
import { WorkerRequestResult } from "../../otherTypes";

export class WorkerServer {
	public readonly id: string;
	public readonly url: string;
	public readonly port: number;
	public readonly cpu_count: number;
	public readonly dirsCount: number;
	public pingLatency: number;
	public tasksCount: number;
	public dirs: string[];
	public readonly client: RgWeb;

	/**
	 * Проверить соединение
	 * @returns пинг до сервера
	 */
	public async checkConnection(): Promise<RgResult<number>> {
		try{
			const result = await ping(this.url, this.port);
			this.pingLatency = result;
			
			return {
				is_success: true,
				data: result
			}
		} catch(Ex: any) {
			this.pingLatency = -1;

			return {
				is_success: false,
				error: {
					code: parseInt(Ex),
					message: `Check connection error, code ${Ex}`
				}
			}
		}
	}

	/**
	 * Получить информацию о загрузке процессора
	 * @returns Значение от 0 до 100
	 */
	public async getCpuUsage(): Promise<RgResult<number>> {
		const reqResult = await this.client.request({
			method: "GET",
			path: "/cpuUsageInfo"
		}, null);

		if (reqResult.is_success){
			return {
				is_success: true,
				data: parseInt(reqResult.data)
			}
		}

		return reqResult;
	}
	
	/**
	 * Получить информацию по использованию оперативной памяти сервером
	 * @returns 
	 */
	public async getRamInfo(): Promise<RgResult<{ total: number; used: number; }>> {
		const reqResult = await this.client.request({
			method: "GET",
			path: "/ramUsageInfo"
		}, null);

		if (reqResult.is_success){
			return {
				is_success: true,
				data: JSON.parse(reqResult.data)
			}
		}

		return reqResult;
	}

	/**
	 * Загрузить фотографию на сервер и получить её айди для создания будущих задач по поиску лица
	 * @param pathToFile Путь к загружаемой фотографии
	 */
	public async getImageId(
		pathToFile: string
	): Promise<RgResult<string>> {
		const result = await this.checkConnection();

		if (result.is_success){
			const uploadResult = await new Promise<RgResult<string>>((resolve, reject) => {
				request.post(
					`http://${this.url}:${this.port}/uploadCheckFile`,
					{
						formData: {
							filedata: fs.createReadStream(pathToFile)
						}
					},
					(err, response, body) => {
						if (err){
							resolve({
								is_success: false,
								error: {
									code: WorkerRequestError.UNKNOWN_ERROR,
									message: err
								}
							});
						} else if (response){
							if (response.statusCode == 200){
								const reqResult: WorkerRequestResult = JSON.parse(response.body);
						
								if (reqResult.code == 0){
									resolve({
										is_success: true,
										data: reqResult.data
									});
								} else {
									resolve({
										is_success: false,
										error: {
											code: reqResult.code,
											message: reqResult.data
										}
									})
								}
							} else {
								resolve({
									is_success: false,
									error: {
										code: WorkerRequestError.UNKNOWN_ERROR,
										message: response.body
									}
								});
							}
						}
					}
				)
			});

			return uploadResult
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
	 * Загрузить фотографию на сервер(пополнение базы фотографий) 
	 * */
	public async uploadImage(
		pathToFile: string,
		dirname: string
	): Promise<RgResult<null>>{
		const result = await this.checkConnection();

		if (result.is_success){
			await new Promise<RgResult<string>>((resolve, reject) => {
				request.post(
					`http://${this.url}:${this.port}/addFile?dir=${dirname}`,
					{
						formData: {
							filedata: fs.createReadStream(pathToFile)
						}
					},
					(err, response, body) => {
						if (err){
							resolve({
								is_success: false,
								error: {
									code: 1,
									message: err
								}
							});
						} else {
							resolve({
								is_success: true,
								data: body
							});
						}
					}
				)}
			);

			return {
				is_success: true,
				data: null
			};
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
	 * Создать на сервере задачу по поиску лица
	 * */
	 public async createServerTask(
		imageId: string,
		checkDirName: string
	): Promise<RgResult<string>>{
		const result = await this.checkConnection();

		if (result.is_success){
			const serverCreateTaskResult = await this.client.request({
				path: encodeURI(`/createTask?fileid=${imageId}&directory=${checkDirName}`),
				method: "GET"
			}, null);

			if (serverCreateTaskResult.is_success){
				const createResult = JSON.parse(serverCreateTaskResult.data) as { code: number, message: string };

				if (createResult.code !== 0){
					return {
						is_success: false,
						error: createResult
					}
				} else {
					return {
						is_success: true,
						data: createResult.message
					}
				}
			} else {
				return serverCreateTaskResult;
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
	 * Создать папку на сервере 
	 * */
	public async createDir(
		dirname: string
	): Promise<RgResult<null>>{
		const result = await this.checkConnection();

		if (result.is_success){
			const result = await this.client.request({
				path: `/addDir?dir=${dirname}`
			}, null)

			if (result.is_success){
				return {
					is_success: true,
					data: null
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
	 * Узнать количество всех задач (активных + тех что в очереди) 
	 * */
	public async getTasksCount(): Promise<RgResult<number>> {
		const result = await this.client.request({
			path: "/getTasksCount",
			method: "GET",
			port: this.port
		}, null);

		if (result.is_success){
			this.tasksCount = parseInt(result.data);

			return {
				is_success: true,
				data: parseInt(result.data)
			}
		}

		return result;
	}

	/**
	 * Получить список директорий на сервере 
	 * */
	public async getDirs(): Promise<RgResult<string[]>>{
		const result = await this.checkConnection();
		if (result.is_success){
			const result = await this.client.request({
				path: `/getDirList`,
				method: "GET"
			}, null)

			if (result.is_success){
				this.dirs = result.data.split(',');

				return {
					is_success: true,
					data: this.dirs
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
	 * Проверить существование папки с фотографиями
	 * в случае успеха возвращает количество файлов в папке
	 */
	public async dirExists(dir: string): Promise<RgResult<number>> {
		const result = await this.checkConnection();

		if (result.is_success){
			const result = await this.client.request({
				path: `/checkDir?dir=${dir}`,
				method: "GET"
			}, null)

			if (result.is_success){
				if (result.http_status_code == 200){
					return {
						is_success: true,
						data: parseInt(result.data)
					}
				} else {
					return {
						is_success: false,
						error: {
							code: result.http_status_code,
							message: `404 not found`
						}
					}
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
	 * Удалить директорию на удалённом сервере
	 * */
	public async rmDir(dir: string): Promise<RgResult<null>> {
		const result = await this.checkConnection();

		if (result.is_success){
			const result = await this.client.request({
				path: `/removeDir?dirname=${dir}`,
				method: "GET"
			}, null)

			if (result.is_success){
				return {
					is_success: true,
					data: null
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
	 * Проверить существование файла 
	 * @param dir наименование директории
	 * @param photo наименование фотографии
	 * @param getCheckSumm запросить контрольную сумму
	*/
	public async photoExists(dir: string, photo: string, getCheckSumm = false): Promise<RgResult<number>>{
		const result = await this.checkConnection();

		if (result.is_success){
			const result = await this.client.request({
				path: encodeURI(`/checkPhoto?dirname=${dir}&photo=${photo}&checksumm=${getCheckSumm ? "1" : "0"}`),
				method: "GET"
			}, null)

			if (result.is_success){
				if (result.http_status_code == 200){
					return {
						is_success: true,
						data: getCheckSumm ? parseInt(result.data) : 0
					}
				} else {
					return {
						is_success: false,
						error: {
							code: result.http_status_code,
							message: `404 dir not found`
						}
					}
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

	constructor(
		id: string,
		url: string,
		port: number,
		cpuCount: number,
		dirsCount: number
	){
		this.id = id;
		this.url = url;
		this.port = port;
		this.cpu_count = cpuCount;
		this.dirsCount = dirsCount;
		this.pingLatency = 0;
		this.tasksCount = 0;
		this.dirs = [];
		this.client = new RgWeb(this.url, this.port, "HTTP");
		
		this.checkConnection().then(result => {
			if (!result.is_success){
				Logger.enterLog(`Ошибка проверки соединения с добавленным сервером ${url}:${port}`, LogLevel.ERROR)
			}
		});
	}
}

/**Информация о найденых ошибках на сервере
 * @field dir - наименование директории которая либо не существует, либо в которой найдены ошибочные файлы
 * @field files - наименование файлов, которые признаны ошибочными
 */
export type BadDirsReport = {
	dir: string,
	files: string[]
}

/**Запущенный в сети таск */
export type ActiveTask = {
	taskId: string;
	dir: string;
}

/**Информация об ошибке запуска проверки директории */
export type ErrorStartCheckDir = {
	dir: string;
	code: CreateTaskErrors;
}

/**
 * Задача по поиску лица в сети
 */
export type SearchFaceTask = {
	id: string;

	/**Блокировка */
	mutex: Mutex;

	//Исходная фотография
	sourcePhoto: string;

	//Сервер - идентификатор фото на этом сервере
	uploadedPhotosId: Map<string, string>;

	//Приоритет, чем меньше - тем быстрее будет обработана
	priority: number;

	//**Задачи, которые ещё необходимо запстить */
	inQueue: string[];
	
	/**Запущенные на серверах задачи проверки папок */
	inProcess: ActiveTask[];
	
	/**Задачи, которые не были запущены по причине ошибки запуска */
	errorStart: ErrorStartCheckDir[];

	//Наименования папок, проверка которых уже завершена
	completed: string[];

	//Наименования папок, в которых было найдено совпадение лица
	found: string[];
}