import { ApiServer } from "./components/ApiServer";
import 'dotenv/config';
import { MainWorkerServer } from "./components/mainWorkerServer";
import * as fs from "fs";
import { Distributor } from "./components/filesDistribution/fileDistributor";
import { WorkersManager } from "./components/workersManagement/workersManager";
import { FileServersInfoStorage } from "./components/workersManagement/serverInfoStorage";
import { Logger } from "../Logger";

async function main(): Promise<void> {
	Logger.init();

	if (!fs.existsSync(process.env.PHOTOS_DIRECTORY || "images")){
		fs.mkdirSync(process.env.PHOTOS_DIRECTORY || "images");
	}

	if (!fs.existsSync(process.env.DEFAULT_TEMPORARY_IMAGES_DIR || "temporaryFiles")){
		fs.mkdirSync(process.env.DEFAULT_TEMPORARY_IMAGES_DIR || "temporaryFiles");
	}

	const serversStorage = new FileServersInfoStorage(process.env.SERVERS_INFO_FILE || "servers.db");
	const workersManager = new WorkersManager(
		{
			//Хранилище информации о серверах
			storage: serversStorage
		},{
			//Загрузить ли автоматически информацию о серверах
			loadServersList: process.argv.includes("--loadServersList")
		}
	);

	const mainWorkerServer = new MainWorkerServer(workersManager);

	const distrib = new Distributor(
		mainWorkerServer,
		{
			loadDb: process.argv.includes("--loadDb"),
			loadDirs: process.argv.includes("--loadDirs"),
			checkDistribution: process.argv.includes("--checkDistribution"),
			updateServersList: process.argv.includes("--loadServersList")
		}
	);
	

	const server = new ApiServer(
		mainWorkerServer,
		distrib,
		process.env.DEFAULT_TEMPORARY_IMAGES_DIR || "temporaryFiles"
	);
	
	mainWorkerServer.runServer(parseInt(process.env.MAIN_WORKER_SERVER_PORT || "9010"));
	server.runServer(parseInt(process.env.API_SERVER_PORT || "9301"));
}

main();