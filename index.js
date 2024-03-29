/**
 * @typedef {{
 * 	root: string;
 * 	opts: Options;
 * 	logger: Logger;
 * 	do(f: () => void): void;
 * }} Application
 * 
 * @typedef {{
 * 	catch(f: (error: any) => void): Except;
 * 	finally(f: () => void): void;
 * }} Except
 * 
 * @typedef {{
 * 	id: string;
 * 	git_pull_url: string;
 * 	owner: {
 * 		login: string;
 * 	};
 * }} GitHub.Gist
 * 
 * @typedef {{
 * 	name: string;
 * 	owner: {
 * 		login: string;
 * 	};
 * }} GitHub.Repository
 * 
 * @typedef {{
 * 	user: string;
 * 	auth: string;
 * 	fake?: boolean;
 * }} Options
 * 
 * @typedef {{
 * 	info(msg: string): void;
 * 	success(msg: string): void;
 * 	error(msg: string): void;
 * }} Logger
 */

// @ts-check
const fs = require("node:fs");
const path = require("node:path");
const {execSync} = require("node:child_process");
const {except} = require("@stein197/util/util");

const API_HOST = "https://api.github.com";
const Type = {
	Repo: "repo",
	Gist: "gist"
};
/** @type {Application} */
let app;

/**
 * @param {string} root
 * @param {string} type
 * @param {Partial<Options>} opts
 * @param {Logger} logger
 * @returns {Promise}
 */
module.exports = function (root, type, opts, logger) {
	app = app_create(root, type, opts, logger);
	switch (type) {
		case Type.Repo: return repo_sync_all();
		case Type.Gist: return gist_sync_all();
	}
	return Promise.resolve();
}

// #region git

/**
 * @param {string} url
 */
function git_clone(url) {
	app.logger.info(`Cloning ${url}...`);
	app.do(() => exec(app.root, `git clone ${url}`));
	app.logger.success(`${url} has been successfully cloned`);
}

/**
 * @param {string} dir
 */
function git_fetch(dir) {
	app.logger.info(`Fetching ${dir}...`);
	app.do(() => exec(dir, "git fetch"));
	app.logger.success(`${dir} has been successfully fetched`);
}

/**
 * @param {string} dir
 */
function git_pull(dir) {
	app.logger.info(`Pulling ${dir}...`);
	app.do(() => exec(dir, "git pull"));
	app.logger.success(`${dir} has been successfully pulled`);
}

/**
 * @param {string} name
 * @param {string} url
 */
function git_sync(name, url) {
	const git_dir = path.resolve(app.root, name);
	const dir_exists = fs.existsSync(git_dir);
	if (dir_exists)
		except(() => {
			git_pull(git_dir);
		}).catch(() => {
			app.logger.error(`Failed to pull ${name}. Trying to fetch it...`);
			git_fetch(git_dir);
		}).catch(() => {
			app.logger.error(`Failed to fetch ${name}`);
		});
	else
		try {
			git_clone(url);
		} catch {
			app.logger.error(`Failed to clone ${name}`);
		}
}

// #endregion

// #region gist

/**
 * @param {string} user
 * @param {string} auth
 * @returns {Promise<GitHub.Gist[]>}
 */
function gist_fetch_all(user, auth) {
	return data_fetch("/gists", user, auth).then(data => data.filter(gist => gist.owner.login === user));
}

/**
 * @returns {Promise}
 */
async function gist_sync_all() {
	app.logger.info("Fetching gist info...");
	const data = await gist_fetch_all(app.opts.user, app.opts.auth);
	for (const gist of data)
		git_sync(gist.id, gist.git_pull_url);
}

// #endregion

// #region repo

/**
 * @param {string} user
 * @param {string} auth
 * @returns {Promise<GitHub.Repository[]>}
 */
function repo_fetch_all(user, auth) {
	return data_fetch("/user/repos", user, auth).then(data => data.filter(repo => repo.owner.login === user));
}

/**
 * @returns {Promise}
 */
async function repo_sync_all() {
	app.logger.info("Fetching repositories info...");
	const data = await repo_fetch_all(app.opts.user, app.opts.auth);
	for (const repo of data)
		git_sync(repo.name, `git@github.com:${app.opts.user}/${repo.name}`);
}

// #endregion

/**
 * @param {string} type
 */
function type_check(type) {
	const types_allowed = Object.values(Type);
	if (!types_allowed.includes(type))
		throw new Error(`Unknown type ${type}: Allowed types are ${types_allowed.join(", ")}`);
}

/**
 * @param {Partial<Options>} opts
 * @returns {asserts opts is Options}
 */
function options_check(opts) {
	if (!opts.user?.length)
		throw new Error("User is not provided");
	if (!opts.auth?.length)
		throw new Error("Auth is not provided");
}

/**
 * @param {string} root
 * @param {string} type
 * @param {Partial<Options>} opts
 * @param {Logger} logger
 * @returns {Application}
 */
function app_create(root, type, opts, logger) {
	type_check(type);
	options_check(opts);
	return {root, opts, logger, do: f => !opts.fake && f()};
}

/**
 * @param {string} endpoint
 * @param {string} user
 * @param {string} auth
 * @returns {Promise<any[]>}
 */
async function data_fetch(endpoint, user, auth) {
	let page = 1;
	let result = [];
	while (true) {
		const response = await fetch(API_HOST + endpoint + "?page=" + page, {
			headers: {
				Authorization: `token ${auth}`
			}
		});
		const data = await response.json();
		if (response.status >= 400)
			throw new Error(`Failed to fetch data for user ${user} at ${endpoint}: ${data.message}`);
		if (!Array.isArray(data))
			throw new Error(`Expected to be array. Actual value: ${JSON.stringify(data)}`);
		result.push(...data);
		if (!data.length)
			break;
		page++;
	}
	return result;
}

/**
 * @param {string} dir
 * @param {string} cmd
 * @returns {Buffer}
 */
function exec(dir, cmd) {
	return execSync(cmd, {
		cwd: dir
	});
}
