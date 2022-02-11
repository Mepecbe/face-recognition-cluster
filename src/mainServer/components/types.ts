import { RgResult } from "rg";
import * as ping from "node-http-ping";
import { Logger, LogLevel } from "../../Logger";
import * as request from "request";
import { RgWeb } from "rg-web";
import * as fs from "fs";

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
	 * Загрузить фотографию на сервер и получить её айди для создания будущих задач по поиску лица
	 * @param pathToFile Путь к загружаемой фотографии
	 */
	public async getImageId(
		pathToFile: string
	): Promise<RgResult<string>> {
		const result = await this.checkConnection();

		if (result.is_success){
			const fileId = await new Promise<string>((resolve, reject) => {request.post(
				`http://${this.url}:${this.port}/uploadCheckFile`,
				{
					port: 9032,
					formData: {
						filedata: fs.createReadStream(pathToFile)
					}
				},
				(err, response, body) => {
					if (err){
						reject(err);
					} else if (response){
						resolve(response.body);
					}
				}
			)});

			return {
				is_success: true,
				data: fileId
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
			const serverCreateTaskResult = await new Promise<RgResult<string>>((resolve, reject) => {
				request.get(
					`http://${this.url}:${this.port}/createTask?fileid=${imageId}&directory=${checkDirName}`,
					undefined,
					(err, response, body) => {
						if (err){
							resolve({
								is_success: false,
								error: {
									code: 1,
									message: err
								}
							});
						} else if (response){
							resolve(response.body);
						}
					}
				)}
			);

			if (serverCreateTaskResult.is_success){
				return {
					is_success: true,
					data: serverCreateTaskResult.data
				};
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

export type ActiveTask = {
	taskId: string;
	dir: string;
}

/**
 * Задача по поиску лица в сети
 */
export type SearchFaceTask = {
	id: string;

	//Исходная фотография
	sourcePhoto: string;

	//Сервер - идентификатор фото на этом сервере
	uploadedPhotosId: Map<string, string>;

	//Приоритет, чем меньше - тем быстрее будет обработана
	priority: number;

	//Наименования папок, проверку которых ещё необходимо осуществить
	inQueue: string[];
	
	//Запущенные задачи
	inProcess: ActiveTask[];

	//Наименования папок, проверка которых уже завершена
	completed: string[];

	//Наименования папок, в которых было найдено совпадение лица
	found: string[];
}