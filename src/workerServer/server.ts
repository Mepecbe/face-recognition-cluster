import * as ExpressFramework from "express";
import * as BodyParser from "body-parser";
import * as multer from "multer";
import * as request from "request";
import * as fs from "fs";
import {
	spawn,
	spawnSync,
	ChildProcessWithoutNullStreams,
	exec,
	execFile
} from "child_process";
import { Logger, LogLevel } from "../Logger";
import { TaskResult, TaskState, WorkerTaskManager } from "./pyTasks";
import { PythonWorkerErrorCodes } from "./enums";
import * as ping from "node-http-ping";
import 'dotenv/config';
import * as os from "os";
import { WorkerRequestError } from "../workerErrors";
import * as osUtils from "os-utils";

/**Сервер поиска лиц */
export class FaceRecognitionServer {
	private readonly Server: ExpressFramework.Express;
	private readonly taskManager: WorkerTaskManager;

	private readonly ROOT_SERVER: string;
	private readonly ROOT_SERVER_PORT: number;

	private prober: NodeJS.Timer | undefined = undefined;

	public async run(port: number): Promise<void> {
		{
			//Проверка доступности корневого сервера
			try{
				const result = await ping(this.ROOT_SERVER, this.ROOT_SERVER_PORT);
				Logger.enterLog(`[FaceRecognitionServer.run] Серверный пинг ${result}`, LogLevel.INFO);

				if (this.prober !== undefined){
					clearInterval(this.prober);
				}
			} catch(Ex: any) {
				Logger.enterLog(`[FaceRecognitionServer.run] Ошибка подключения к корневому серверу(${this.ROOT_SERVER}:${this.ROOT_SERVER_PORT}), exit ` + Ex, LogLevel.ERROR);

				if (this.prober == undefined){
					this.prober = setInterval(() => { this.run(port); }, 3000);
				}
				return;
			}
		}

		Logger.enterLog(`[FaceRecognitionServer.run] Запуск сервера на ${port} порту`, LogLevel.INFO);
		this.Server.listen(port);

		{
			// /addServer необходимо теперь отправить серверу запрос регистрации
			request.get(
				`http://${this.ROOT_SERVER}:${this.ROOT_SERVER_PORT}/addServer?ip=${process.env.SERVER_URL || "unknown"}&port=${port}&dirs=${this.taskManager.photosManager.getAllDir().length}&cpuCount=${os.cpus().length}`,
				undefined,
				(err, response, body) => {
					if (response.statusCode == 200){
						Logger.enterLog("Подключён к корневому серверу(зарегистрирован как новый клиент)!", LogLevel.INFO);
					} else if (response.statusCode == 201){
						Logger.enterLog("Подключен к корневому серверу (ранее уже был подключен)!", LogLevel.INFO);
					} else if (response.statusCode == 400){
						Logger.enterLog("Подключение к серверу не успешно!", LogLevel.ERROR);
					}
				}
			)
		}
	}

	/**
	 * Событие окончания задачи 
	 * */
	public async taskCompleted(result: TaskResult): Promise<void> {
		Logger.enterLog(
			`Задача ${result.id} окончена, ${result.found ? `лицо найдено(папка ${result.foundFaceDir})` : "лицо не найдено"}`, 
			LogLevel.INFO
		);

		request.get(
			`http://${this.ROOT_SERVER}:${this.ROOT_SERVER_PORT}/taskResult?taskId=${result.id}&found=${result.found ? `1&faceId=${result.foundFaceDir}` : "0"}`,
			undefined,
			(err, response, body) => {
				if (err){
					Logger.enterLog(err, LogLevel.ERROR);
				} else {
					if (response.statusCode != 200){
						Logger.enterLog(`Ошибка отправки результата выполнения задачи ${body}`, LogLevel.ERROR);
					}
				}
			}
		)
	}

	constructor(
		taskManager: WorkerTaskManager
	){
		this.Server = ExpressFramework();
		this.taskManager = taskManager;
		taskManager.onTaskCompleted.on(this.taskCompleted.bind(this));

		this.ROOT_SERVER = process.env.ROOT_SERVER_URL || "127.0.0.1";
		this.ROOT_SERVER_PORT = parseInt(process.env.ROOT_SERVER_PORT || "9010");

		this.Server.use(multer( { dest: "uploads" } ).single("filedata"));
		this.Server.use(BodyParser.json());
		//this.Server.use(BodyParser.urlencoded());

		/**Информация об использовании оперативной памяти */
		this.Server.get("/ramUsageInfo", async (req, res) => {
			res.write(JSON.stringify({
				total: os.totalmem(),
				used: os.totalmem() - os.freemem()
			}));

			res.statusCode = 200; res.end();
		});

		/**Информация об использовании процессора */
		this.Server.get("/cpuUsageInfo", async (req, res) => {
			const cpuUsage = await new Promise<number>(
				(resolve) => { 
					osUtils.cpuUsage((usage) => {
						resolve(usage);
					})
				}
			);

			res.write((cpuUsage * 100).toString());
			res.statusCode = 200; res.end();
		});

		/**Обработчик результата от скриптов поиска */
		this.Server.get(`/taskResult`, async (req, res) =>{
			if (typeof(req.query["id"]) !== "string"){
				return;
			}

			switch(req.query["action"]){
				case "start": {
					Logger.enterLog(`Task ${req.query["id"]} is started!`, LogLevel.WARN);
					taskManager.updateTaskState(req.query["id"], TaskState.CheckImages);
					break;
				}

				case "error": {
					switch (parseInt(req.query["code"]?.toString() || "-1")){
						case PythonWorkerErrorCodes.FACE_NOT_FOUND: {
							Logger.enterLog(`Задача ${req.query["id"]}: внимание, лицо на фотографии не найдено ${req.query["file"]}`, LogLevel.WARN);
							break;
						}

						default: {
							Logger.enterLog(`Задача ${req.query["id"]}: неизвестная ошибка с кодом ${req.query["code"]}, информация -> ${req.query}`, LogLevel.ERROR);
						}
					}
					break;
				}

				case "result": { //РЕЗУЛЬТАТ ПРОВЕРКИ ЛИЦА
					if (req.query["status"] == "True"){
						this.taskManager.taskCompleted(req.query["id"], true);
					} else if (req.query["status"] == "False"){
						this.taskManager.taskCompleted(req.query["id"], false);
					}
					break;
				}

				default: {
					console.warn(req.query);
				}
			}


			res.statusCode = 200;
			res.end();
		});

		/**Запрос количества задач */
		this.Server.get(`/getTasksCount`, async (req, res) => {
			res.write(this.taskManager.getPendingCount().toString());
			res.statusCode = 200;
			res.end();
		});
		
		/**Запрос списка директорий */
		this.Server.get(`/getDirList`, async (req, res) => {
			res.write(JSON.stringify({
				code: 0,
				data: this.taskManager.photosManager.getAllDir().join(',')
			}));
		});

		//ДЛЯ ПРИЁМА ФАЙЛОВ НА ПРОВЕРКУ
		this.Server.post(`/uploadCheckFile`, async (req, res) => {
			const filedata = req.file;

			if (!filedata){
				res.write(JSON.stringify({
					code: WorkerRequestError.FILEDATA_UNDEFINED,
					data: "filedata is undefined"
				}));

				res.end();
				return;
			}
			
			Logger.enterLog(`[/uploadCheckFile] Для задачи принят файл ${(filedata.size / 1024).toFixed(2)} КБайт`, LogLevel.WARN);

			//Возвращаем оригинальный формат файла
			fs.rename(
				`uploads/${filedata.filename}`, 
				`uploads/${filedata.filename}.${filedata.originalname.split(".")[1]}`, 
				(err) => { console.error(err); }
			);

			res.send(JSON.stringify({
				code: 0,
				data: filedata.filename
			}));
			res.end();
		});

		//ДЛЯ СОЗДАНИЯ ЗАДАЧ
		this.Server.get(`/createTask`, async (req, res) => {
			if (typeof(req.query["fileid"]) != "string" || typeof(req.query["directory"]) != "string"){
				res.statusCode = 400;
				res.write("Unknown fileid or directory name");
				res.end();
				return;
			}

			if (!this.taskManager.photosManager.checkExistsDir(req.query["directory"])){
				res.statusCode = 400;
				res.write("directory not found");
				res.end();
				return;
			}

			const createResult = await this.taskManager.addTask(
				req.query["fileid"],
				req.query["directory"]
			);

			if (createResult.is_success){
				res.write(JSON.stringify({
					code: 0,
					message: createResult.data
				}));
			} else {
				res.write(
					JSON.stringify({
						code: createResult.error.code,
						message: createResult.error.message
					})
				);
			}

			res.end();
		});


		/**остальное */
		
		//Пополнение базы фотографий
		this.Server.post(`/addFile`, async (req, res) => {
			const filedata = req.file;

			if (!filedata){
				res.write("filedata is undefined");
				res.statusCode = 400;
				res.end();
				return;
			}

			if (typeof(req.query["dir"]) !== "string"){
				res.write("param dir is undefined");
				res.statusCode = 400;
				res.end();
				return;
			}
			
			const fullPath = process.env.PHOTOS_DIRECTORY + req.query["dir"] + "/";

			Logger.enterLog(`Для базы загружено фото размером ${(filedata.size / 1024).toFixed(2)} КБ`, LogLevel.INFO);

			if (!fs.existsSync(fullPath)){
				fs.mkdirSync(fullPath);
			}

			//Возвращаем оригинальный формат файла и перемещаем в нужную директорию
			fs.rename(
				`uploads/${filedata.filename}`,
				fullPath + `${filedata.originalname}`,
				(err) => { console.error(err); }
			);

			res.statusCode = 200;
			res.end();
		});

		this.Server.get('/removeDir', async (req, res) => {
			if (typeof(req.query["dirname"]) !== "string"){
				res.write(`Param dir is undefined!`);
				res.statusCode = 400;
				res.end();
				return;
			}

			Logger.enterLog(`Удаляю директорию ${req.query["dirname"]}`, LogLevel.INFO);
			this.taskManager.photosManager.rmDir(req.query["dirname"]);

			res.statusCode = 200;
			res.end();
		});

		//Просто создание папки под фотографии
		this.Server.get(`/addDir`, async (req, res) => {
			if (typeof(req.query["dir"]) !== "string"){
				console.log(`param dir is undefined`);
				res.write("param dir is undefined");
				res.statusCode = 400;
				res.end();
				return;
			}

			const fullPath = process.env.PHOTOS_DIRECTORY + req.query["dir"] + "/";

			if (!fs.existsSync(fullPath)){
				Logger.enterLog(`Create dir ${req.query["dir"]}`, LogLevel.WARN);
				fs.mkdirSync(fullPath);
			}

			res.statusCode = 200;
			res.end();
		});

	
		this.Server.get(`/checkDir`, async (req, res) => {
			if (typeof(req.query["dir"]) !== "string"){
				res.write("param dir is undefined");
				res.statusCode = 400;
				res.end();
				return;
			}
			
			const fullPath = process.env.PHOTOS_DIRECTORY + req.query["dir"];

			if (this.taskManager.photosManager.checkExistsDir(req.query["dir"])){
				//Если директория существует, то отвечаем сколько файлов в ней находится
				let count = fs.readdirSync(fullPath).length;
				res.write(count.toString());
				res.statusCode = 200;
				res.end();
			} else {
				res.statusCode = 404;
				res.end();
			}
		});


		this.Server.get('/checkPhoto', async (req, res) => {
			let getCheckSumm = false;
			
			if (typeof(req.query["dirname"]) !== "string"){
				res.write(`Param dirname is undefined`);
				res.statusCode = 400;
				res.end();
				return;
			}

			if (typeof(req.query["photo"]) !== "string"){
				res.write(`Param dirname is undefined`);
				res.statusCode = 400;
				res.end();
				return;
			}

			if (req.query["checksumm"] == "1"){
				getCheckSumm = true;
			}
		
			const result = this.taskManager.photosManager.checkPhoto(req.query["dirname"], req.query["photo"], getCheckSumm);
			Logger.enterLog(`Проверка файла ${req.query["dirname"]}/${req.query["photo"]}`, LogLevel.INFO);
	
			if (result != 0){
				res.write(result.toString());
				res.statusCode = 200;
				res.end();
			} else {
				res.statusCode = 404;
				res.end();
			}
		});
	}
}