import { ApiServer } from "./components/ApiServer";
import 'dotenv/config';
import { MainWorkerServer } from "./components/mainWorkerServer";
import * as fs from "fs";
import { Distributor } from "./components/filesDistribution/fileDistributor";

async function main(): Promise<void> {
	if (!fs.existsSync(process.env.PHOTOS_DIRECTORY || "images")){
		fs.mkdirSync(process.env.PHOTOS_DIRECTORY || "images");
	}


	const mainWorkerServer = new MainWorkerServer();

	const distrib = new Distributor(
		mainWorkerServer,
		true,
		true,
		true
	);

	mainWorkerServer.runServer(parseInt(process.env.MAIN_WORKER_SERVER_PORT || "9010"));

	
	//const server = new ApiServer(mainWorkerServer);
	//server.runServer(8080);
}

main();