import { Logger, LogLevel } from "../../Logger";
import * as ExpressFramework from "express";
import * as BodyParser from "body-parser";
import { WorkerServer } from "./types";
import { RgResult } from "rg";
import { Utils } from "./utils";
import request = require("request");
import * as fs from "fs";


/**Главный сервер, служит для связи и общения с другими серверами, которые занимаются поиском лица */
export class MainWorkerServer{
	private readonly Server: ExpressFramework.Express;
	private readonly Checker: NodeJS.Timer;

	/**====================WORKERS API========================*/
	//Подключённые сервера
	private servers: WorkerServer[];

	public async uploadImage(pathToFile: string): Promise<RgResult<{
		server: WorkerServer,
		imageId: string
	}>>{
		const server = Utils.parseTasksCount(this.servers);

		const result = await server.checkConnection();
		if (result.is_success){
			const fileId = await new Promise<string>((resolve, reject) => {request.post(
				`http://${server.url}:${server.port}/fileUpload`,
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

			console.log(`File UPLOAD, id ${fileId}`);
			return {
				is_success: true,
				data: {
					server,
					imageId: fileId
				}
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

	/**Создать задачу по поиску лица на сервере
	 * @param fileId Идентификатор ранее загруженного на сервер файла
	 * @param server Сервер, который будет осуществлять поиск
	 * @param dirname Наименование папки, в которой будет осуществлятся поиск
	 * @returns Идентификатор созданной задачи
	 */
	public async createTask(fileId: string, server: WorkerServer, dirname: string): Promise<RgResult<string>>{
		//http://127.0.0.1:9009/createTask?fileid=46779127c191961bb922743fca0812b1&directory=qwerty
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

	public async getDirs(server: WorkerServer): Promise<RgResult<string[]>>{
		const result = await server.checkConnection();
		if (result.is_success){
			const result = await server.client.request({
				path: `/getDirList`,
				method: "GET"
			}, null)

			if (result.is_success){
				return {
					is_success: true,
					data: result.data.split(',')
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
	/**====================WORKERS API========================*/

	/**Чекер серверов(проверяет пинг, загруженность задачами) */
	async serversChecker(): Promise<void> {
		for(const srv of this.servers){
			await srv.checkConnection();
			await srv.getTasksCount();
		}
	}

	runServer(port: number): void {
		Logger.enterLog(`[MainWorkerServer] Запуск сервера на порту ${port}`, LogLevel.INFO);
		this.Server.listen(port);
	}

	constructor(
	){
		this.servers = [];

		this.Server = ExpressFramework();
		this.Server.use(BodyParser.json());
		//this.Server.use(BodyParser.urlencoded());

		this.Checker = setInterval(this.serversChecker.bind(this), parseInt(process.env.SERVER_CHECKER_TIMEOUT || "60") * 1000);

		//Connection checker
		this.Server.get(`/`, async (req, res) =>{
			res.statusCode = 200;
			res.end();
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

			for (const srv of this.servers){
				if (srv.url == DESTINATION_SERVER_URL && srv.port == parseInt(DESTINATION_SERVER_PORT)){
					Logger.enterLog(`Server not added(ALREADY EXISTS), ${DESTINATION_SERVER_URL}:${DESTINATION_SERVER_PORT}, CPUs ${DESTINATION_SERVER_CPU_COUNT}, dirs ${DESTINATION_SERVER_DIRS_COUNT}`, LogLevel.WARN);
					return;
				}
			}

			this.servers.push(
				new WorkerServer(
					DESTINATION_SERVER_URL,
					parseInt(DESTINATION_SERVER_PORT),
					parseInt(DESTINATION_SERVER_CPU_COUNT),
					parseInt(DESTINATION_SERVER_DIRS_COUNT)
				)
			);

			Logger.enterLog(`Added new server, ${DESTINATION_SERVER_URL}:${DESTINATION_SERVER_PORT}, CPUs ${DESTINATION_SERVER_CPU_COUNT}, dirs ${DESTINATION_SERVER_DIRS_COUNT}`, LogLevel.INFO);

			this.uploadImage("me.jpg").then(async (result) => {
				if (result.is_success){
					console.log(`Try create task`);
					const taskCreateResult = await this.createTask(result.data.imageId, result.data.server, "qwerty");
					console.log(`task result `, taskCreateResult);
				}
			})

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