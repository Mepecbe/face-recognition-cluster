import { CreateTaskErrors, WorkerRequestError } from "./workerErrors";

/**Результат запроса к воркеру */
export type WorkerRequestResult = {
	code: 0 | CreateTaskErrors | WorkerRequestError;
	data?: any;
}