import { Logger, LogLevel } from "../Logger";
import { WorkerTaskManager } from "./pyTasks";
import { FaceRecognitionServer } from "./server";


async function main(): Promise<void>{
	const taskManager = new WorkerTaskManager(parseInt(process.env.WORKERS_PORT ? process.env.WORKERS_PORT : "9009"));
	const server = new FaceRecognitionServer(taskManager);
	server.run(parseInt(process.env.WORKERS_PORT ? process.env.WORKERS_PORT : "9009"));

	console.error = (err: any) => {
		Logger.enterLog(`Непредвиденная ошибка ${err}`, LogLevel.ERROR);
	};
}

main();