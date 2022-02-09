import {
	spawn,
	spawnSync,
	ChildProcessWithoutNullStreams,
	exec,
	execFile
} from "child_process";
import { Event, RgResult, timeout } from "rg";
import * as uuid from "uuid";
import { Logger, LogLevel } from "../Logger";
import * as os from "os";
import { PhotosManager } from "./photosDbManager";
import { Utils } from "./utils";
import * as fs from "fs";

export enum TaskState {
	WaitLoadSourceImage,
	CheckImages,
	Completed
}

export type Task = {
	/**Исходный файл(находящийся в папке uploads) */
	sourceFace: string;
	/**Наименование папки, в которой производится проверка */
	checkDirectory: string;
	/**Состояние задачи */
	state: TaskState;
	/**Процесс скрипта */
	process: ChildProcessWithoutNullStreams;
}

export type PendingTask = {
	id: string;
	/**Исходный файл(находящийся в папке uploads) */
	sourceFile: string;
	checkDir: string;
}

export type TaskResult = {
	id: string;
	found: boolean;
	sourceFaceDir: string;
	foundFaceDir: string;
}

/**Менеджер задач РАБОЧЕГО СЕРВЕРА (сервер по поиску лиц)
 * каждая задача - скрипт на языке python
 * каждый скрипт на питоне проверяет одну папку
 */
export class WorkerTaskManager {
	/**Порт сервера, на который .py скриптам отправлять информацию о деятельности */
	private readonly httpServerPort: number;
	/**Максимальное количество одновременно работающих задач */
	private readonly MAX_TASK;

	/**Активные задачи */
	private activeTaskPool: Map<string, Task> = new Map();
	/**Задачи ожидающие запуска */
	private pendingTaskPool: PendingTask[] = [];

	/**Загрузчик задач */
	private taskLoader: NodeJS.Timer;

	public onTaskCompleted: Event<TaskResult> = new Event();

	public photosManager: PhotosManager;

	/**Обновить статус у задачи */
	public updateTaskState(
		id: string,
		newState: TaskState
	): void {
		const task = this.activeTaskPool.get(id);

		if (task){
			task.state = newState;
			this.activeTaskPool.set(id, task);
		} else {
			Logger.enterLog(`[updateTaskState] Task ${id} not found, new state ${newState}`, LogLevel.ERROR);
		}
	}

	/**Завершить задачу */
	public taskCompleted(
		id: string,
		found: boolean
	): void {
		const task = this.activeTaskPool.get(id);

		if (task){
			this.activeTaskPool.delete(id);

			this.onTaskCompleted.emit({
				id,
				found,
				foundFaceDir: task.checkDirectory,
				sourceFaceDir: task.sourceFace
			});
		} else {
			Logger.enterLog(`[taskCompleted] Task ${id} not found, task result ${found}`, LogLevel.ERROR);
		}
	}

	public getPendingCount(): number {
		return this.pendingTaskPool.length + this.activeTaskPool.size;
	}

	/**Создать новую задачу по поиску лица 
	 * @argument sourceFilePath путь к исходному файлу(например uploads/123.jpg)
	 * @argument checkDirectoryPath путь к папке, в которой находятся проверяемые файлы(например /var/photos/qw3d3d3/)
	*/
	public runTask(
		sourceFilePath: string,
		checkDirectoryPath: string,
		taskid?: string
	): void {
		if (!checkDirectoryPath.endsWith("/")){
			checkDirectoryPath += "/";
		}

		const id = taskid ? taskid : uuid.v4();

		const proc = spawn("python3", [ "faceChecker.py", id, `${sourceFilePath}`, `${checkDirectoryPath}`, this.httpServerPort.toString()]);
		/*proc.stdout.pipe(process.stdout);
		proc.stderr.pipe(process.stdout);*/
		proc.unref();

		this.activeTaskPool.set(id, {
			sourceFace: sourceFilePath,
			state: TaskState.WaitLoadSourceImage,
			process: proc,
			checkDirectory: checkDirectoryPath
		});

		Logger.enterLog(`Run task ${id}, active ${this.activeTaskPool.size}`, LogLevel.INFO);
	}

	/**
	 * Добавить задачу в очередь 
	 */
	public addTask(
		filename: string,
		checkDirectory: string
	): Promise<RgResult<string>> {
		return new Promise<RgResult<string>>((resolve, reject) => {
			fs.readdir(process.env.PHOTOS_DIRECTORY + checkDirectory, (err, result) => {
				if (err){
					resolve({
						is_success: false,
						error: {
							code: 1,
							message: err.message
						}
					});
				} else {
					if (result.length == 0){
						resolve({
							is_success: false,
							error: {
								code: 1,
								message: `Not files in directory`
							}
						});
					} else {
						const id = uuid.v4();
						Logger.enterLog(`Create pending task ${id}, file ${filename}, dir ${checkDirectory}`, LogLevel.INFO);

						this.pendingTaskPool.push({
							id,
							sourceFile: "uploads/" + filename,
							checkDir: process.env.PHOTOS_DIRECTORY + checkDirectory
						})

						resolve({
							is_success: true,
							data: id
						});
					}
				}
			});
		});
	}

	async loader(): Promise<void> {
		if (this.pendingTaskPool.length == 0){
			return;
		}

		if (this.activeTaskPool.size < this.MAX_TASK){
			const task = this.pendingTaskPool.shift();

			if (task){
				const fullFile = Utils.getFullFilename(task.sourceFile.split("/")[1], "uploads/");

				if (fullFile.found){
					Logger.enterLog(`[Loader] Run task ${task.id}, source file ${fullFile.file}, directory ${task.checkDir}`, LogLevel.INFO);
					this.runTask(`uploads/${fullFile.file}`, task.checkDir);
				} else {
					Logger.enterLog(`[Loader] File not found`, LogLevel.ERROR);
				}
			}
		}
	}

	constructor(
		httpServerPort: number
	){
		this.MAX_TASK = parseInt(process.env.MAX_TASK || os.cpus().length.toString());
		this.httpServerPort = httpServerPort;
		this.taskLoader = setInterval(this.loader.bind(this), 100);
		this.photosManager = new PhotosManager();

		Logger.enterLog(`[WorkerTaskManager] Init, max tasks ${this.MAX_TASK}, workers port ${this.httpServerPort}`, LogLevel.INFO);
	}
}