import { MainWorkerServer } from "../mainWorkerServer";
import { BadDirsReport, WorkerServer } from "../types";
import * as fs from "fs";
import { Logger, LogLevel } from "../../../Logger";
import { FileInfoStorage, FileStorage } from "./filesInfoStorage";
import { RgResult, timeout } from "rg";
import * as progress from "cli-progress";
import * as ansiColors from "ansi-colors";
import * as CRC32 from "crc-32";
import { WorkersManager } from "../workersManagement/workersManager";

/**Основная задача - распределение файлов и папок между серверами */
export class Distributor{
	private readonly PHOTOS_DIRECTORY: string;
	private workersManager: WorkersManager;

	/**Оффлайн хранилище */
	private storage: FileInfoStorage;

	//Идентификатор сервера - папки загруженные на него
	private filesDb: Map<string, string[]> = new Map();

	//Не распределенные по серверам папки
	private notDistributedDirs: string[] = [];

	/**Получить количество директорий */
	async getDirsCount(): Promise<number> {
		return new Promise((resolve, reject) => {
			if (!fs.existsSync(this.PHOTOS_DIRECTORY)){
				fs.mkdir(this.PHOTOS_DIRECTORY, undefined, (err) => {
					if (err){
						Logger.enterLog(`Ошибка создания папки с фотографиями ${err?.code}`, LogLevel.ERROR);
					} else {
						Logger.enterLog(`Созданна папка с фотографиями`, LogLevel.WARN);
					}
				});

				resolve(0);
			}

			fs.readdir(this.PHOTOS_DIRECTORY, (err, result) => {
				if (err){
					reject(err);
				} else {
					resolve(result.length);
				}
			})
		})
	}

	/**Получить количество не распределенных файлов */
	getNotDistributedCount(): number {
		return this.notDistributedDirs.length;
	}

	/**Получить сумарное количество распределенных файлов */
	getDistributedCount(): number {
		let count = 0;

		for (const s of this.filesDb){
			count += s[1].length
		}

		return count;
	}

	/**
	 * Обновить список серверов
	 * @argument onlyActiveServers Если True, то загрузить только активные серверы(предварительная проверка соединения)
	 * */
	async updateServersList(onlyActiveServers: boolean): Promise<number> {
		const servers = this.workersManager.getServers();

		for (const s of servers){
			if (onlyActiveServers){
				const checkConnResult = await s.checkConnection();

				if (!checkConnResult.is_success){
					continue;
				}
			}

			if (!this.filesDb.has(s.id)){
				this.filesDb.set(s.id, []);
			}
		}

		return this.filesDb.size;
	}

	clearInfo(): void {
		this.filesDb.clear();
		this.saveDb();
	}

	/**Загрузить список директорий находящихся на этом сервере и поместить список не распределенных */
	async loadDirs(callback?: () => void, log = true): Promise<void> {
		fs.readdir(this.PHOTOS_DIRECTORY, undefined, async (err, dirsList) => {
			if (err){
				Logger.enterLog(`[loadDirs] Ошибка загрузки директорий ${err}`, LogLevel.ERROR);
			}

			let counter = 0;
			let bar: progress.SingleBar | undefined = undefined;

			if (log){
				Logger.blockMessages(true);

				bar = new progress.SingleBar({
					format: 'Загрузка папок |' + ansiColors.cyan('{bar}') + '| {percentage}% || {value}/{total} ',
					barCompleteChar: '\u2588',
					barIncompleteChar: '\u2591',
					hideCursor: true
				});
				bar.start(dirsList.length, 0);
			}

			for(const dir of dirsList){
				bar?.increment();

				if (this.notDistributedDirs.includes(dir)){
					//Если папка уже есть в списке не распределенных
					continue;
				}

				counter++;
				this.notDistributedDirs.push(dir);
				
				if (counter % 1000 == 0){
					//Что бы сервер не "задохнулся" если папок много
					await timeout(100);
				}
			}

			if (bar){
				bar.stop();
				Logger.blockMessages(false);
			}

			Logger.enterLog(`Загружено ${counter} директорий${this.filesDb.size != 0 ? ", рекомендуется провести сверку с базой!" : ""}`, LogLevel.INFO);

			if (callback){
				callback();
			}
		});
	}

	/**Получить местонахождение директории
	 * @returns идентификатор сервера в случае обнаружения
	 */
	getDirLocation(dirName: string): RgResult<string>{
		for (const serverInfo of this.filesDb){
			for (const dir of serverInfo[1]){
				if (dir == dirName){
					return {
						is_success: true,
						data: serverInfo[0]
					}
				}
			}
		}

		return {
			is_success: false,
			error: {
				code: 1,
				message: `Server not found`
			}
		}
	}

	/**Проверка распределения файлов (сверка с данными из базы)
	 * Проверяет каждую папку на наличие её на определенном сервере
	 * Если папка существует на каком-либо сервере, то она удаляется из списка не распределенных папок
	 * Проверка производится только в отношении локальной информации о распределении, для фактической проверки необходимо запускать проверку целостности сети!
	 */
	checkDistribution(): void {
		if (this.filesDb.size == 0){
			Logger.enterLog(`[checkDistibutedDirs] Проверка распределения не будет проведена, так как список серверов с информацией распределения пуст`, LogLevel.WARN);
			return;
		}

		Logger.blockMessages(true);
		let bar: progress.SingleBar | undefined = undefined;

		bar = new progress.SingleBar({
			format: 'Проверка распределения папок |' + ansiColors.cyan('{bar}') + '| {percentage}% || {value}/{total} ',
			barCompleteChar: '\u2588',
			barIncompleteChar: '\u2591',
			hideCursor: true
		});
		

		bar.start(this.notDistributedDirs.length, 0);

		for(let index = 0; index < bar.getTotal(); index++){
			bar?.increment();

			const dir = this.notDistributedDirs.pop();

			if (!dir){
				continue;
			}

			const locationSearchResult = this.getDirLocation(dir);

			if(!locationSearchResult.is_success){
				this.notDistributedDirs.unshift(dir);
			} else {
				//сервер, на котором расположена директория найден, обратно в список добавлять не требуется
			}
		}
		
		bar?.stop();
		Logger.blockMessages(false);
		Logger.enterLog(`Проверка распределения завершена, не распределено ${this.notDistributedDirs.length} папок`, LogLevel.INFO)
	}

	getServersList(): string[] {
		const result: string[] = [];

		for (const srv of this.filesDb){
			result.push(srv[0]);
		}

		return result;
	}

	/**
	 * Получить список всех распределенных директорий
	 * @returns Массив директорий
	 */
	getAllDistributedDirs(): string[] {
		let result: string[] = [];

		for (const srv of this.filesDb){
			result = result.concat(result, srv[1]);
		}

		return result;
	}

	/**Проверить целостность сети
	 * @argument fixServerErrors исправлять ли ошибки целостности
	 * @argument fullCheck проверять ли файлы (если false - будет проверено только наличие папок)
	 */
	async checkNetworkIntegrity(fixServerErrors = false, fullCheck = false): Promise<void> {
		if (this.filesDb.size == 0){
			Logger.enterLog(`[checkNetworkIntegrity] Проверка целостности сети прервана(серверов нет)`, LogLevel.WARN);
			return;
		} else {
			Logger.enterLog(`[checkNetworkIntegrity] Начинаю проверку целостности сети${fullCheck ? `, проверка контрольных сумм` : ""}${fixServerErrors ? `, авто-исправление ошибок` : ""}`, LogLevel.WARN);
		}

		let barServerDirs: Map<string, BadDirsReport[]> = new Map();

		for (const workersManager of this.filesDb){
			const serverInfo = this.workersManager.getServer(workersManager[0]);

			if (serverInfo.is_success){
				const checkConnectionResult = await serverInfo.data.checkConnection();

				if (!checkConnectionResult.is_success){
					Logger.enterLog(`Целостность сервера ${serverInfo.data.url}:${serverInfo.data.port} не будет проверена(ошибка связи)`, LogLevel.WARN);
					continue;
				}

				Logger.blockMessages(true);
				const bar = new progress.SingleBar({
					format: `Проверка целостности сервера ${serverInfo.data.url}:${serverInfo.data.port}|` + ansiColors.cyan('{bar}') + '| {percentage}% || {value}/{total} Директория {dir}, файл {currFileNumber}/{totalFiles}',
					barCompleteChar: '\u2588',
					barIncompleteChar: '\u2591',
					hideCursor: true
				});

				bar.start(workersManager[1].length, 0);

				bar.increment(0, {
					currFileNumber: 0,
					totalFiles: 0,
					dir: ""
				});

				//dir - [badPhoto1, badPhoto2], если опция fullCheck активна
				const badDirs: BadDirsReport[] = [];

				for (const dir of workersManager[1]){
					//Проверка директории удаленного сервера

					const result = await serverInfo.data.dirExists(dir);
					const badFiles: string[] = [];

					bar.increment(1, {
						currFileNumber: 0,
						totalFiles: 0,
						dir
					});

					if (!result.is_success){
						if (result.error.code == 404){
							badDirs.push({
								dir,
								files: []
							});
						} else {
							//Connection error
							continue;
						}
					} else {
						//Директория существует

						if (fullCheck){
							//Проверяем файлы директории
							const files = fs.readdirSync(this.PHOTOS_DIRECTORY + dir);

							if (files.length != 0){
								for (let fileIndex = 0; fileIndex < files.length; fileIndex++){
									bar.increment(0, {
										currFileNumber: fileIndex+1,
										totalFiles: files.length
									});

									const serverCheckFileResult = await serverInfo.data.photoExists(dir, files[fileIndex], true);

									if (serverCheckFileResult.is_success){
										//Файл существует
										const originalFileCheckSumm = CRC32.buf(fs.readFileSync(this.PHOTOS_DIRECTORY + dir + "/" + files[fileIndex]), 0);

										if (serverCheckFileResult.data !== originalFileCheckSumm){
											//bad file
											Logger.enterLog(`Контрольная сумма файлов не совпала ${dir}/${files[fileIndex]}`, LogLevel.WARN);
											badFiles.push(files[fileIndex]);
										}
									} else {
										//Файл не существует
										if (serverCheckFileResult.error.code == 404){
											badFiles.push(files[fileIndex]);
										} else {
											Logger.enterLog(`[checkNetworkIntegrity] UNKNOWN ERROR code ${serverCheckFileResult.error.code}, message ${serverCheckFileResult.error.message}, check dir ${dir}, file ${files[fileIndex]}`, LogLevel.ERROR);
										}
									}
								}

								if (badFiles.length > 0){
									badDirs.push({
										dir,
										files: badFiles
									})
								}
							}
						}
					}
				}


				bar.stop();
				Logger.blockMessages(false);

				if (badDirs.length != 0){
					barServerDirs.set(serverInfo.data.id, badDirs);
				}
			} else {
				Logger.enterLog(`[checkNetworkIntegrity] Сервер ${workersManager[0]} не найден`, LogLevel.WARN);
			}
		}

		if (barServerDirs.size != 0){
			Logger.enterLog(`[checkNetworkIntegrity] Проверка выявила ошибки целостности! `, LogLevel.WARN);

			for (const info of barServerDirs){
				Logger.enterLog(`  На сервере ${info[0]} найдено ${info[1].length} ошибок целостности${fixServerErrors ? `, начинаю исправление` : `, авто-исправление отключено`}`, LogLevel.INFO);
			}

			if (fixServerErrors){
				let totalFilesUploaded = 0;
				let totalUploadErrors = 0;
				let notFoundDirs: string[] = [];

				for (const info of barServerDirs){
					const serverInfo = this.workersManager.getServer(info[0]);

					if (serverInfo.is_success){
						const checkConnectResult = await serverInfo.data.checkConnection();

						if (checkConnectResult.is_success){
							let uploadedFiles = 0;
							let uploadErrors = 0;

							Logger.blockMessages(true);

							const bar = new progress.SingleBar({
								format: `Исправление ошибок сервера ${serverInfo.data.url}:${serverInfo.data.port} | ${ansiColors.cyan('{bar}')}| {percentage}% || {value}/{total}, загружаемая директория {dir}`,
								barCompleteChar: '\u2588',
								barIncompleteChar: '\u2591',
								hideCursor: true
							});

							bar.start(info[1].length, 0);

							for (const report of info[1]){
								bar.increment(1, {
									dir: report.dir
								});

								if (!fs.existsSync(this.PHOTOS_DIRECTORY + report.dir)){
									notFoundDirs.push(report.dir);
									continue;
								}

								const photos = fs.readdirSync(this.PHOTOS_DIRECTORY + report.dir);

								if (photos.length > 0){
									for (const photo of photos){
										const uploadPhotoResult = await serverInfo.data.uploadImage(this.PHOTOS_DIRECTORY + report.dir + "/" + photo, report.dir);
										
										if (uploadPhotoResult.is_success){
											uploadedFiles++;
										} else {
											uploadErrors++;
										}
									}
								} else {
									await serverInfo.data.createDir(report.dir);
								}
							}

							bar.stop();
							Logger.blockMessages(false);

							totalFilesUploaded += uploadedFiles;
							totalUploadErrors += uploadErrors;

							Logger.enterLog(`Исправление ошибок сервера завершено, выгружено файлов ${uploadedFiles}, ошибок выгрузки ${uploadErrors}, всего папок не найдено ${notFoundDirs.length}`, LogLevel.INFO);
						}
					}
				}
				
				Logger.enterLog(`Исправление ошибок сети завершено, выгружено всего файлов ${totalFilesUploaded}, ошибок выгрузки ${totalUploadErrors}, всего папок не найдено на локальном носителе ${notFoundDirs.length}`, LogLevel.INFO);

				if (totalUploadErrors != 0 || notFoundDirs.length != 0){
					Logger.enterLog(`Рекомендуется провести повторную полную загрузку папок и проверку целостности сети!`, LogLevel.WARN);
				}

				if (notFoundDirs.length != 0){
					Logger.enterLog(`Возможно требуется проверка локального носителя главного сервера!!!`, LogLevel.WARN);
				}
			}
		} else {
			Logger.enterLog(`Проверка не выявила ошибки целостности! `, LogLevel.INFO);
		}
	}

	/**Запустить автоматическое распределение */
	async runAutoDistrib(
		params: {
			loadDirs: boolean,
			checkDistribution: boolean
		}
	): Promise<void> {
		if (params.loadDirs){
			Logger.enterLog(`[autoDistrib] Загрузка директорий`, LogLevel.WARN);
			await this.loadDirs();
		}

		if (params.checkDistribution){
			Logger.enterLog(`[autoDistrib] Проверка распределения`, LogLevel.WARN);
			this.checkDistribution();
		}

		if (this.notDistributedDirs.length == 0){
			Logger.enterLog(`[autoDistrib] Распределение файлов остановлено, нет директорий доступных для распределения`, LogLevel.WARN);
			return;
		}

		const countDirsPerServer = Math.ceil(this.notDistributedDirs.length / this.filesDb.size);

		Logger.enterLog(`[autoDistrib] Старт распределения, всего папок для распределения ${this.notDistributedDirs.length}, количество доступных серверов ${this.filesDb.size}, на один сервер приходится ${countDirsPerServer} папок`, LogLevel.WARN);

		let totalUploadedDirs = 0;

		for (const serverFiles of this.filesDb){
			const serverInfo = this.workersManager.getServer(serverFiles[0]);

			if (serverInfo.is_success){
				const checkConnection = await serverInfo.data.checkConnection();

				if (!checkConnection.is_success){
					Logger.enterLog(`[autoDistrib] Сервер ${serverInfo.data.url}:${serverInfo.data.port} не доступен для распределения(ошибка проверки связи)`, LogLevel.WARN);
					continue;
				} else {
					//Проверка связи успешна
				}

				const bar = new progress.SingleBar({
					format: `Распределение файлов на сервер ${serverInfo.data.url}:${serverInfo.data.port} | ${ansiColors.cyan('{bar}')}| {percentage}% || {value}/{total} {dir}`,
					barCompleteChar: '\u2588',
					barIncompleteChar: '\u2591',
					hideCursor: true
				});

				Logger.blockMessages(true);
				bar.start(countDirsPerServer, 0);

				//Количество успешно загруженых файлов
				let filesUploaded = 0;

				//Количество загрузок файлов с ошибками
				let filesUploadError = 0;

				//Директории, которые не получилось выгрузить
				let dirsUploadErrors: string[] = [];

				//Загрузка части файлов, предназначенной для этого сервера
				for (let counter = countDirsPerServer; counter > 0; counter--){
					const dir = this.notDistributedDirs.pop();

					if (!dir){
						Logger.enterLog(`[runAutoDistrib] Unknown error, dir undefined`, LogLevel.WARN);
						continue;
					}

					const filesList = fs.readdirSync(this.PHOTOS_DIRECTORY + dir);

					if (filesList.length > 0){
						let errors = 0;

						for (const f of filesList){
							const uploadImageResult = await serverInfo.data.uploadImage(this.PHOTOS_DIRECTORY + dir + "/" + f, dir);

							if (uploadImageResult.is_success){
								filesUploaded++;
							} else {
								errors++;
								continue;
							}
						}

						filesUploadError += errors;

						if (errors > 0){
							//Если хотя бы 1 файл не получилось выгрузить - папка считается не распределенной
							dirsUploadErrors.push(dir);
							continue;
						} else {
							serverFiles[1].push(dir);
							totalUploadedDirs++;
						}
					} else {
						const createDirResult = await serverInfo.data.createDir(dir);

						if (!createDirResult.is_success){
							dirsUploadErrors.push(dir);
							continue;
						} else {
							serverFiles[1].push(dir);
							totalUploadedDirs++;
						}
					}

					bar.increment(1, {
						dir
					});
				}

				this.filesDb.set(serverFiles[0], serverFiles[1]);

				bar.stop();
				Logger.blockMessages(false);

				Logger.enterLog(`На сервер ${serverInfo.data.url}:${serverInfo.data.port} отправлено ${filesUploaded} файлов ${filesUploadError != 0 ? `, не отправлено ${filesUploadError} файлов` : ""} ${ dirsUploadErrors.length != 0 ? `, не отправлено ${dirsUploadErrors.length} папок ` : ``}`, LogLevel.INFO);
			} else {
				Logger.enterLog(`[autoDistrib] Информация о сервере не найдена, srv id ${serverFiles[0]}`, LogLevel.WARN);
			}
		}

		Logger.enterLog(`[autoDistrib] Новые данные о распределении сохранены, выгружено ${totalUploadedDirs} папок`, LogLevel.WARN);
		this.saveDb();
	}

	/**Автоматическое перераспределение */
	async runReDistribution(): Promise<void> {
		for (const srv of this.filesDb){
			const serverInfo = this.workersManager.getServer(srv[0]);

			if (serverInfo.is_success){
				if ((await serverInfo.data.checkConnection()).is_success){
					Logger.enterLog(`[runReDistribution] Очистка сервера ${serverInfo.data.url}:${serverInfo.data.port}`, LogLevel.WARN);
					await serverInfo.data.rmDir("");
					await timeout(4_000);
				}
			}
		}

		await timeout(6_000);

		{
			Logger.enterLog(`[runReDistribution] Очистка информации о распределении`, LogLevel.INFO);
			this.filesDb.clear();

			Logger.enterLog(`[runReDistribution] Обновление списка серверов для распределения`, LogLevel.INFO);
			await this.updateServersList(true);

			Logger.enterLog(`[runReDistribution] Для распределения доступно серверов ${this.filesDb.size}`, LogLevel.INFO);
		}

		{
			await this.loadDirs();
			Logger.enterLog(`[runReDistribution] Доступно папок для распределения ${this.notDistributedDirs.length}`, LogLevel.INFO);
		}

		await timeout(1_000);

		await this.runAutoDistrib({
			loadDirs: false,
			checkDistribution: false
		})
	}

	/**Загрузить данные о распределении файлов и папок среди сети серверов из хранилища */
	loadDb(): void {
		this.storage.loadData().map((element) => {
			this.filesDb.set(element.serverId, element.dirs);
		});
	}

	/**Сохранить данные о распределении файлов и папок среди сети серверов в хранилища */
	saveDb(): void {
		this.storage.saveData(Array.from(this.filesDb).map(el => { 
			return {
				serverId: el[0],
				dirs: el[1]
			}
		}));
	}

	/**
	 * 
	 * @param workersManager Главный управляющий сервер
	 * @param loadDb Загружать ли базу с информацией распределения на серверах
	 * @param loadDirs Загружать ли список директорий в список не распределённых
	 * @param checkDistribution Проверять распределение информации на серверах(не реальная проверка, сверка с данными из базы), крайне рекомендуется при каждой загрузке папок
	 */
	constructor(
		workersManager: WorkersManager,
		settings: {
			loadDb: boolean,
			loadDirs: boolean,
			checkDistribution: boolean,
			updateServersList: boolean
		}
	) {
		this.workersManager = workersManager;
		this.storage = new FileStorage(process.env.DISTRIBUTOR_DB_FILE || "distrib.db");
		this.PHOTOS_DIRECTORY = process.env.PHOTOS_DIRECTORY || "images/";

		if (settings.loadDb){
			this.loadDb();
			
			let allDirs = 0;
			for (const s of this.filesDb){
				allDirs += s[1].length;
			}

			Logger.enterLog(`[fileDistibutor] Загружена информация о директориях на серверах, записей о серверах ${this.filesDb.size}, суммарно папок на удалённых серверах ${allDirs}`, LogLevel.INFO);
		}

		if (settings.loadDirs){
			if (settings.checkDistribution){
				Logger.enterLog(`[fileDistibutor] Начинаю загрузку директорий с последующей проверкой на основании сохранённых данных`, LogLevel.INFO); 
				this.loadDirs(() => { 
					Logger.enterLog(`[fileDistibutor] Загружено директорий ${this.notDistributedDirs.length}! Запускаю проверку распределения папок(сверка с данными из базы)`, LogLevel.INFO); 
					this.checkDistribution();
				});
			} else {
				Logger.enterLog(`[fileDistibutor] Начинаю загрузку директорий без проверки распределения`, LogLevel.INFO); 
				this.loadDirs(() => { 
					Logger.enterLog(`[fileDistibutor] Загружено директорий ${this.notDistributedDirs.length}!`, LogLevel.INFO);
				});
			}
		}

		if (settings.updateServersList){
			this.updateServersList(true);
		}
	}
}