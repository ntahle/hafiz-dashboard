window.addEventListener('DOMContentLoaded', () => {
	// ---------- Broker ----------
	// The dashboard subscribes to the topic tree the phone app publishes to.
	// These are the demo broker's credentials.
	const MQTT_CONFIG = {
		url: 'wss://z181062f.ala.us-east-1.emqxsl.com:8084/mqtt',
		username: 'syafiq',
		password: 'syafiq',
		topicRoot: 'testtopic/hafiz-dash',
	};
	const STATE_PREFIX = MQTT_CONFIG.topicRoot + '/state/';
	const EVENT_TOPIC = MQTT_CONFIG.topicRoot + '/scan';
	const CACHE_KEY = 'hafiz_dashboard_cache_v1';
	const THEME_KEY = 'hafiz_dashboard_theme';
	const DEMO_OFF_KEY = 'hafiz_dashboard_demo_off';
	const MAX_CACHED_CUSTOMERS = 500;
	const MAX_EVENTS = 50;

	// ---------- Elements ----------
	const els = {
		connectionPill: document.getElementById('connectionPill'),
		connectionText: document.getElementById('connectionText'),
		themeToggle: document.getElementById('themeToggle'),
		statToday: document.getElementById('statToday'),
		statWeek: document.getElementById('statWeek'),
		statWeekNote: document.getElementById('statWeekNote'),
		statActive: document.getElementById('statActive'),
		statTotal: document.getElementById('statTotal'),
		statTotalNote: document.getElementById('statTotalNote'),
		statUpdated: document.getElementById('statUpdated'),
		statUpdatedNote: document.getElementById('statUpdatedNote'),
		trendChart: document.getElementById('trendChart'),
		trendEmpty: document.getElementById('trendEmpty'),
		trendTotal: document.getElementById('trendTotal'),
		trendAverage: document.getElementById('trendAverage'),
		trendPeak: document.getElementById('trendPeak'),
		trendRangeButtons: [...document.querySelectorAll('[data-trend-range]')],
		customerSearch: document.getElementById('customerSearch'),
		customerSort: document.getElementById('customerSort'),
		demoBanner: document.getElementById('demoBanner'),
		demoBannerBtn: document.getElementById('demoBannerBtn'),
		demoBtn: document.getElementById('demoBtn'),
		dataMenuBtn: document.getElementById('dataMenuBtn'),
		dataMenu: document.getElementById('dataMenu'),
		resetBtn: document.getElementById('resetBtn'),
		importBtn: document.getElementById('importBtn'),
		importInput: document.getElementById('importInput'),
		importStatus: document.getElementById('importStatus'),
		exportBtn: document.getElementById('exportBtn'),
		customerTable: document.getElementById('customerTable'),
		customerRows: document.getElementById('customerRows'),
		emptyState: document.getElementById('emptyState'),
		emptyTitle: document.getElementById('emptyTitle'),
		emptyNote: document.getElementById('emptyNote'),
		activityList: document.getElementById('activityList'),
		activityEmpty: document.getElementById('activityEmpty'),
		activityCount: document.getElementById('activityCount'),
		dialog: document.getElementById('customerDialog'),
		dialogCloseBtn: document.getElementById('dialogCloseBtn'),
		dialogTitle: document.getElementById('dialogTitle'),
		dialogToday: document.getElementById('dialogToday'),
		dialogWeek: document.getElementById('dialogWeek'),
		dialogTotal: document.getElementById('dialogTotal'),
		dialogLastScan: document.getElementById('dialogLastScan'),
		customerChart: document.getElementById('customerChart'),
		rangeButtons: [...document.querySelectorAll('[data-range]')],
		resetDialog: document.getElementById('resetDialog'),
		resetCancelBtn: document.getElementById('resetCancelBtn'),
		resetConfirmBtn: document.getElementById('resetConfirmBtn'),
	};

	// ---------- State ----------
	const customers = new Map();
	const events = [];
	let mqttClient = null;
	let subscribed = false;
	let sessionAccountIds = new Set();
	let retainedSyncTimer = null;
	let renderTimer = null;
	let saveTimer = null;
	let importStatusTimer = null;
	let selectedAccountId = null;
	let chartRange = 7;
	let trendRange = 7;
	let themePreference = 'system';
	let demoLoaded = false;

	// ---------- Helpers ----------
	function makeId(prefix) {
		try {
			if (window.crypto && typeof window.crypto.randomUUID === 'function') {
				return prefix + window.crypto.randomUUID().replace(/-/g, '').slice(0, 10);
			}
		} catch (_) {}
		return prefix + Math.random().toString(16).slice(2, 10);
	}

	function dateKey(date) {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		return year + '-' + month + '-' + day;
	}

	function startOfWeekDate(date) {
		const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
		const offset = (start.getDay() + 6) % 7; // Monday is day zero.
		start.setDate(start.getDate() - offset);
		return start;
	}

	function lastDays(count) {
		const today = new Date();
		const days = [];
		for (let offset = count - 1; offset >= 0; offset -= 1) {
			days.push(new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset));
		}
		return days;
	}

	function toNumber(value) {
		const number = Number(value);
		return Number.isFinite(number) ? number : 0;
	}

	function formatNumber(value) {
		return Math.round(toNumber(value)).toLocaleString('en-GB');
	}

	function formatDayShort(date) {
		return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
	}

	function formatTime(value) {
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '';
		return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
	}

	function formatDateTime(value) {
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return 'No scans';
		return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + ', ' + formatTime(date);
	}

	function formatLongDate(date) {
		return date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
	}

	function formatRelative(value) {
		const then = new Date(value).getTime();
		if (Number.isNaN(then)) return 'Waiting for data';

		const minutes = Math.max(0, Math.floor((Date.now() - then) / 60000));
		if (minutes < 1) return 'Just now';
		if (minutes < 60) return minutes + (minutes === 1 ? ' minute ago' : ' minutes ago');

		const hours = Math.floor(minutes / 60);
		if (hours < 24) return hours + (hours === 1 ? ' hour ago' : ' hours ago');

		const days = Math.floor(hours / 24);
		if (days < 30) return days + (days === 1 ? ' day ago' : ' days ago');

		const months = Math.floor(days / 30);
		return months + (months === 1 ? ' month ago' : ' months ago');
	}

	// ---------- Sample data ----------
	// The dashboard opens with a small set of fake customers so it can be
	// demonstrated before any phone publishes. A real snapshot clears them.
	const DEMO_CUSTOMERS = [
		{ accountId: 'demo-customer-1', customer: 'Customer 1', seed: 3, recent: [12, 8, 0, 11, 9, 15, 20], total: 480, minutesAgo: 2 },
		{ accountId: 'demo-customer-2', customer: 'Customer 2', seed: 5, recent: [4, 6, 0, 5, 8, 3, 12], total: 330, minutesAgo: 7 },
		{ accountId: 'demo-customer-3', customer: 'Customer 3', seed: 7, recent: [0, 0, 0, 3, 4, 5, 6], total: 210, minutesAgo: 14 },
		{ accountId: 'demo-customer-4', customer: 'Customer 4', seed: 9, recent: [0, 0, 0, 0, 0, 0, 0], total: 160, minutesAgo: 9 * 24 * 60 },
	];
	const DEMO_EVENTS = [
		{ accountId: 'demo-customer-3', customer: 'Customer 3', bottles: 1, minutesAgo: 1 },
		{ accountId: 'demo-customer-2', customer: 'Customer 2', bottles: 1, minutesAgo: 4 },
		{ accountId: 'demo-customer-1', customer: 'Customer 1', bottles: 1, minutesAgo: 7 },
		{ accountId: 'demo-customer-3', customer: 'Customer 3', bottles: 1, minutesAgo: 10 },
		{ accountId: 'demo-customer-1', customer: 'Customer 1', bottles: 1, minutesAgo: 12 },
		{ accountId: 'demo-customer-2', customer: 'Customer 2', bottles: 1, minutesAgo: 15 },
	];

	function sumDaily(daily, startKey, endKey) {
		let total = 0;
		Object.keys(daily).forEach((key) => {
			if (key >= startKey && key <= endKey) total += toNumber(daily[key]);
		});
		return total;
	}

	function makeDemoDaily(config) {
		const daily = {};
		const now = new Date();

		// Older days give the 30-day chart some shape. The most recent
		// seven days are pinned so today and this week always look real.
		for (let offset = 29; offset >= 7; offset -= 1) {
			if ((offset + config.seed) % 9 === 0) continue;
			const value = 2 + ((offset * 5 + config.seed * 3) % 11);
			const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
			daily[dateKey(date)] = value;
		}

		config.recent.forEach((value, index) => {
			if (value <= 0) return;
			const offset = 6 - index;
			const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
			daily[dateKey(date)] = value;
		});

		return daily;
	}

	function demoLastScan(minutesAgo) {
		const now = new Date();
		if (minutesAgo < 1440) {
			const minutesSinceMidnight = now.getHours() * 60 + now.getMinutes();
			const safeMinutes = minutesAgo >= minutesSinceMidnight
				? Math.max(1, minutesSinceMidnight - 1)
				: minutesAgo;
			return new Date(Date.now() - safeMinutes * 60000).toISOString();
		}
		return new Date(Date.now() - minutesAgo * 60000).toISOString();
	}

	function buildDemoCustomers() {
		const now = new Date();
		const todayKey = dateKey(now);
		const weekStartKey = dateKey(startOfWeekDate(now));

		return DEMO_CUSTOMERS.map((config) => {
			const daily = makeDemoDaily(config);
			const lastScanAt = demoLastScan(config.minutesAgo);

			return {
				accountId: config.accountId,
				customer: config.customer,
				day: todayKey,
				weekStart: weekStartKey,
				today: daily[todayKey] || 0,
				week: sumDaily(daily, weekStartKey, todayKey),
				total: config.total,
				daily,
				lastScanAt,
				updatedAt: lastScanAt,
				demo: true,
			};
		});
	}

	function buildDemoEvents() {
		return DEMO_EVENTS.map((config, index) => ({
			eventId: 'demo-event-' + index,
			accountId: config.accountId,
			customer: config.customer,
			bottles: config.bottles,
			scannedAt: demoLastScan(config.minutesAgo),
			demo: true,
		}));
	}

	function updateDemoUI() {
		if (els.demoBanner) els.demoBanner.hidden = !demoLoaded;
		if (els.demoBtn) {
			els.demoBtn.textContent = demoLoaded ? 'Clear sample data' : 'Load sample data';
			els.demoBtn.dataset.action = demoLoaded ? 'clear' : 'load';
		}
	}

	function clearDemoData(options) {
		const settings = options || {};
		let changed = false;

		clearTimeout(importStatusTimer);
		if (els.importStatus) els.importStatus.hidden = true;

		[...customers.keys()].forEach((accountId) => {
			if (customers.get(accountId).demo) {
				customers.delete(accountId);
				changed = true;
			}
		});

		for (let index = events.length - 1; index >= 0; index -= 1) {
			if (events[index].demo) {
				events.splice(index, 1);
				changed = true;
			}
		}

		demoLoaded = false;
		updateDemoUI();

		if (settings.manual) {
			try { localStorage.setItem(DEMO_OFF_KEY, '1'); } catch (_) {}
		}

		if (changed) {
			if (settings.persist !== false) scheduleSave();
			scheduleRender();
		}
	}

	function loadDemoData() {
		clearDemoData({ persist: false });

		buildDemoCustomers().forEach((customer) => {
			customers.set(customer.accountId, customer);
		});

		buildDemoEvents().forEach((event) => {
			if (!events.some((existing) => existing.eventId === event.eventId)) events.push(event);
		});
		events.sort((a, b) => new Date(b.scannedAt).getTime() - new Date(a.scannedAt).getTime());
		if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;

		demoLoaded = true;
		updateDemoUI();
		scheduleRender();

		try { localStorage.removeItem(DEMO_OFF_KEY); } catch (_) {}
	}

	// ---------- Imported sample data ----------
	// "Load my data" accepts a JSON snapshot (one customer, an array, or
	// { customers: [...] }) or a CSV file. Imported rows are sample data,
	// so real MQTT snapshots replace them automatically.
	const IMPORT_HEADER_ALIASES = {
		customer: ['customer', 'customer name', 'name', 'username'],
		accountId: ['account', 'account id', 'accountid', 'customer id', 'id'],
		today: ['today', 'bottles today', 'today bottles'],
		week: ['this week', 'week', 'weekly', 'this week bottles', 'week bottles'],
		total: ['all time', 'alltime', 'total', 'all time bottles', 'total bottles'],
		lastScanAt: ['last scan', 'last scan at', 'last scan date', 'last seen', 'lastscan', 'lastscanat'],
		updatedAt: ['updated', 'updated at', 'last update', 'last updated'],
		date: ['date', 'day', 'scan date'],
		bottles: ['bottles', 'bottle count', 'count', 'scans', 'bottles scanned'],
	};

	function parseImportCount(value) {
		if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : 0;
		const cleaned = String(value == null ? '' : value).replace(/,/g, '').trim();
		if (!cleaned) return 0;
		const number = Number(cleaned);
		return Number.isFinite(number) && number > 0 ? number : 0;
	}

	function parseImportDate(value) {
		if (value == null || value === '') return null;
		if (typeof value === 'number' && value > 20000 && value < 80000) {
			// CSV files from Excel sometimes carry dates as serial numbers.
			const excelDate = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
			return Number.isNaN(excelDate.getTime()) ? null : excelDate.toISOString();
		}
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? null : date.toISOString();
	}

	function importDateKey(value) {
		if (value == null || value === '') return '';
		const text = String(value).trim();
		if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
		const iso = parseImportDate(value);
		return iso ? dateKey(new Date(iso)) : '';
	}

	function parseImportDaily(value) {
		const daily = {};

		if (Array.isArray(value)) {
			value.forEach((entry) => {
				if (!entry || typeof entry !== 'object') return;
				const key = importDateKey(entry.date ?? entry.day);
				const count = parseImportCount(entry.bottles ?? entry.count ?? entry.value);
				if (key && count > 0) daily[key] = (daily[key] || 0) + count;
			});
		} else if (value && typeof value === 'object') {
			Object.keys(value).forEach((rawKey) => {
				const key = importDateKey(rawKey);
				if (!key) return;
				const count = parseImportCount(value[rawKey]);
				if (count > 0) daily[key] = count;
			});
		}

		return daily;
	}

	function importSlug(value) {
		return String(value || '')
			.toLowerCase()
			.normalize('NFKD')
			.replace(/[\u0300-\u036f]/g, '')
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 40);
	}

	function looksLikeImportCustomer(value) {
		if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
		return ['customer', 'name', 'username', 'accountId', 'account', 'id', 'daily', 'days', 'today', 'week', 'total', 'bottles']
			.some((key) => Object.prototype.hasOwnProperty.call(value, key));
	}

	function buildImportedCustomer(raw, index) {
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

		const name = String(raw.customer ?? raw.name ?? raw.username ?? '').trim().slice(0, 80);
		let accountId = String(raw.accountId ?? raw.account ?? raw.id ?? '').trim().slice(0, 80);
		if (!name && !accountId) return null;

		if (!accountId) {
			accountId = 'sample-' + (importSlug(name) || 'customer') + '-' + (index + 1);
		}

		const daily = parseImportDaily(raw.daily ?? raw.days);
		const dailyKeys = Object.keys(daily);
		const now = new Date();
		const todayKey = dateKey(now);
		const weekStartKey = dateKey(startOfWeekDate(now));
		const rawTotal = raw.total ?? raw.allTime ?? raw['all-time'] ?? raw.bottles;
		const dailyTotal = dailyKeys.reduce((sum, key) => sum + toNumber(daily[key]), 0);
		let lastScanAt = parseImportDate(raw.lastScanAt ?? raw.lastScan ?? raw.scannedAt);

		if (!lastScanAt && dailyKeys.length > 0) {
			const latestDay = dailyKeys.sort().slice(-1)[0];
			lastScanAt = new Date(latestDay + 'T12:00:00').toISOString();
		}

		return {
			accountId,
			customer: name || 'Customer ' + (index + 1),
			day: typeof raw.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.day) ? raw.day : todayKey,
			weekStart: typeof raw.weekStart === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.weekStart) ? raw.weekStart : weekStartKey,
			today: dailyKeys.length > 0 ? toNumber(daily[todayKey]) : parseImportCount(raw.today ?? raw.bottlesToday),
			week: dailyKeys.length > 0 ? sumDaily(daily, weekStartKey, todayKey) : parseImportCount(raw.week ?? raw.thisWeek),
			total: rawTotal !== undefined && rawTotal !== null && rawTotal !== '' ? parseImportCount(rawTotal) : dailyTotal,
			daily,
			lastScanAt,
			updatedAt: parseImportDate(raw.updatedAt ?? raw.updated) || lastScanAt || now.toISOString(),
			demo: true,
			imported: true,
		};
	}

	function parseImportJson(text) {
		let data;
		try {
			data = JSON.parse(text);
		} catch (_) {
			throw new Error('That JSON file could not be parsed.');
		}

		let rawRecords = [];
		let rawEvents = [];

		if (Array.isArray(data)) {
			rawRecords = data;
		} else if (data && typeof data === 'object') {
			if (Array.isArray(data.customers)) rawRecords = data.customers;
			else if (Array.isArray(data.records)) rawRecords = data.records;
			else if (data.state && typeof data.state === 'object' && !Array.isArray(data.state)) {
				rawRecords = Object.keys(data.state).map((accountId) => {
					const entry = data.state[accountId];
					return entry && typeof entry === 'object' && !Array.isArray(entry)
						? Object.assign({ accountId }, entry)
						: null;
				}).filter(Boolean);
			} else if (looksLikeImportCustomer(data)) {
				rawRecords = [data];
			} else {
				rawRecords = Object.keys(data)
					.map((key) => [key, data[key]])
					.filter(([, value]) => looksLikeImportCustomer(value))
					.map(([key, value]) => Object.assign({ accountId: key }, value));
			}

			if (Array.isArray(data.events)) rawEvents = data.events;
		}

		return {
			records: rawRecords.map(buildImportedCustomer).filter(Boolean),
			rawEvents,
		};
	}

	function parseImportCsvRows(text, delimiter) {
		const rows = [];
		let row = [];
		let field = '';
		let quoted = false;

		for (let index = 0; index < text.length; index += 1) {
			const character = text[index];

			if (quoted) {
				if (character === '"') {
					if (text[index + 1] === '"') {
						field += '"';
						index += 1;
					} else {
						quoted = false;
					}
				} else {
					field += character;
				}
				continue;
			}

			if (character === '"') {
				quoted = true;
			} else if (character === delimiter) {
				row.push(field);
				field = '';
			} else if (character === '\n' || character === '\r') {
				if (character === '\r' && text[index + 1] === '\n') index += 1;
				row.push(field);
				rows.push(row);
				row = [];
				field = '';
			} else {
				field += character;
			}
		}

		row.push(field);
		rows.push(row);

		return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''));
	}

	function detectImportDelimiter(text) {
		const firstLine = text.split(/\r?\n/, 1)[0] || '';
		const options = [',', ';', '\t'];
		let best = ',';
		let bestCount = -1;

		options.forEach((delimiter) => {
			const count = firstLine.split(delimiter).length - 1;
			if (count > bestCount) {
				best = delimiter;
				bestCount = count;
			}
		});

		return best;
	}

	function normalizeImportHeader(value) {
		return String(value == null ? '' : value)
			.replace(/^\uFEFF/, '')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, ' ')
			.trim();
	}

	function parseImportCsv(text) {
		const delimiter = detectImportDelimiter(text);
		const rows = parseImportCsvRows(text, delimiter);
		if (rows.length < 2) throw new Error('That CSV file needs a header row and at least one customer row.');

		const headers = rows[0].map(normalizeImportHeader);
		const columns = {};

		Object.keys(IMPORT_HEADER_ALIASES).forEach((name) => {
			const index = headers.findIndex((header) => IMPORT_HEADER_ALIASES[name].includes(header));
			if (index !== -1) columns[name] = index;
		});

		const hasCustomer = columns.customer !== undefined || columns.accountId !== undefined;
		const isDaily = columns.date !== undefined && columns.bottles !== undefined;
		const hasSummary = columns.today !== undefined || columns.week !== undefined || columns.total !== undefined || columns.bottles !== undefined;
		if (!hasCustomer || (!isDaily && !hasSummary)) {
			throw new Error('The CSV header needs a customer or account column, plus bottle counts.');
		}

		const cell = (cells, name) => {
			if (columns[name] === undefined) return '';
			const value = cells[columns[name]];
			return String(value == null ? '' : value).trim();
		};

		const records = [];

		if (isDaily) {
			const grouped = new Map();

			rows.slice(1).forEach((cells) => {
				const date = importDateKey(cell(cells, 'date'));
				const bottles = parseImportCount(cell(cells, 'bottles'));
				const customer = cell(cells, 'customer');
				const accountId = cell(cells, 'accountId');
				if (!date || bottles <= 0 || (!customer && !accountId)) return;

				const key = accountId || ('name:' + customer.toLowerCase());
				let entry = grouped.get(key);
				if (!entry) {
					entry = { customer, accountId, daily: {}, total: 0, lastScanAt: null };
					grouped.set(key, entry);
				}

				entry.daily[date] = (entry.daily[date] || 0) + bottles;
				entry.total += bottles;

				const rowScan = parseImportDate(cell(cells, 'lastScanAt')) || new Date(date + 'T12:00:00').toISOString();
				if (!entry.lastScanAt || new Date(rowScan) > new Date(entry.lastScanAt)) entry.lastScanAt = rowScan;
			});

			grouped.forEach((entry) => {
				const built = buildImportedCustomer({
					accountId: entry.accountId,
					customer: entry.customer,
					daily: entry.daily,
					total: entry.total,
					lastScanAt: entry.lastScanAt,
					updatedAt: new Date().toISOString(),
				}, records.length);
				if (built) records.push(built);
			});
		} else {
			rows.slice(1).forEach((cells, index) => {
				const raw = {
					accountId: cell(cells, 'accountId'),
					customer: cell(cells, 'customer'),
					today: cell(cells, 'today'),
					week: cell(cells, 'week'),
					lastScanAt: cell(cells, 'lastScanAt'),
					updatedAt: cell(cells, 'updatedAt'),
				};

				if (columns.total !== undefined) raw.total = cell(cells, 'total');
				else if (columns.bottles !== undefined) raw.total = cell(cells, 'bottles');

				const built = buildImportedCustomer(raw, index);
				if (built) records.push(built);
			});
		}

		if (records.length === 0) throw new Error('No customer rows could be read from that CSV file.');
		return records;
	}

	function parseImportFile(text, fileName) {
		const clean = String(text == null ? '' : text).replace(/^\uFEFF/, '').trim();
		if (!clean) throw new Error('That file is empty.');

		const looksJson = /\.json$/i.test(fileName) || clean.startsWith('{') || clean.startsWith('[');
		const parsed = looksJson
			? parseImportJson(clean)
			: { records: parseImportCsv(clean), rawEvents: [] };

		if (parsed.records.length === 0) throw new Error('No customers were found in that file.');
		return parsed;
	}

	function buildImportedEvents(rawEvents, importedCustomers) {
		if (!Array.isArray(rawEvents)) return [];

		const byAccount = new Map(importedCustomers.map((customer) => [customer.accountId, customer]));
		const imported = [];

		rawEvents.slice(0, MAX_EVENTS).forEach((raw, index) => {
			if (!raw || typeof raw !== 'object') return;

			const accountId = String(raw.accountId ?? raw.account ?? '').trim().slice(0, 80);
			const match = byAccount.get(accountId);
			const customer = String(raw.customer ?? raw.name ?? (match ? match.customer : '')).trim().slice(0, 80);
			const bottles = parseImportCount(raw.bottles ?? raw.count ?? 1);
			const scannedAt = parseImportDate(raw.scannedAt ?? raw.ts ?? raw.date) || new Date().toISOString();
			if (bottles <= 0) return;

			imported.push({
				eventId: 'import-' + String(raw.eventId || (index + '-' + Date.now())).slice(0, 100),
				accountId,
				customer: customer || 'Customer',
				bottles,
				scannedAt,
				demo: true,
				imported: true,
			});
		});

		return imported
			.sort((a, b) => new Date(b.scannedAt).getTime() - new Date(a.scannedAt).getTime())
			.slice(0, MAX_EVENTS);
	}

	function readImportFile(file) {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result || ''));
			reader.onerror = () => reject(new Error('That file could not be read.'));
			reader.readAsText(file);
		});
	}

	function showImportStatus(message, state) {
		clearTimeout(importStatusTimer);
		els.importStatus.textContent = message;
		els.importStatus.dataset.state = state;
		els.importStatus.setAttribute('role', state === 'error' ? 'alert' : 'status');
		els.importStatus.hidden = false;
		if (state !== 'error') {
			importStatusTimer = setTimeout(() => {
				els.importStatus.hidden = true;
			}, 8000);
		}
	}

	function applyImportedData(parsed, fileName) {
		const byId = new Map();
		parsed.records.forEach((customer) => byId.set(customer.accountId, customer));

		const importedCustomers = [...byId.values()];
		if (importedCustomers.length === 0) throw new Error('No customers were found in that file.');

		const importedEvents = buildImportedEvents(parsed.rawEvents, importedCustomers);
		clearDemoData({ persist: false });

		importedCustomers.forEach((customer) => customers.set(customer.accountId, customer));
		importedEvents.forEach((event) => {
			if (!events.some((existing) => existing.eventId === event.eventId)) events.push(event);
		});
		events.sort((a, b) => new Date(b.scannedAt).getTime() - new Date(a.scannedAt).getTime());
		if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;

		demoLoaded = true;
		updateDemoUI();
		saveCache();
		scheduleRender();

		const label = fileName.length > 60 ? fileName.slice(0, 57) + '\u2026' : fileName;
		const scanNote = importedEvents.length > 0
			? ' and ' + importedEvents.length + (importedEvents.length === 1 ? ' scan' : ' scans')
			: '';
		showImportStatus(
			'Loaded ' + importedCustomers.length + (importedCustomers.length === 1 ? ' customer' : ' customers') + scanNote + ' from ' + label + '.',
			'success'
		);
	}

	async function handleImportFile(file) {
		if (!file) return;

		if (file.size > 2 * 1024 * 1024) {
			showImportStatus('That file is larger than 2 MB. Choose a smaller JSON or CSV file.', 'error');
			els.importInput.value = '';
			return;
		}

		try {
			const text = await readImportFile(file);
			applyImportedData(parseImportFile(text, file.name), file.name);
		} catch (error) {
			showImportStatus(error && error.message ? error.message : 'That file could not be loaded.', 'error');
		} finally {
			els.importInput.value = '';
		}
	}

	// ---------- Data ----------
	function normalizeSnapshot(raw, topicAccountId) {
		if (!raw || typeof raw !== 'object') return null;

		const accountId = String(raw.accountId || topicAccountId || '').trim().slice(0, 80);
		if (!accountId) return null;

		const daily = {};
		if (raw.daily && typeof raw.daily === 'object') {
			Object.keys(raw.daily).slice(0, 120).forEach((key) => {
				if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return;
				const value = toNumber(raw.daily[key]);
				if (value > 0) daily[key] = value;
			});
		}

		const updatedAt = new Date(raw.updatedAt || 0).getTime();
		const lastScanAt = raw.lastScanAt ? new Date(raw.lastScanAt).getTime() : NaN;

		return {
			accountId,
			customer: String(raw.customer || 'Unnamed customer').trim().slice(0, 80) || 'Unnamed customer',
			day: typeof raw.day === 'string' ? raw.day : '',
			weekStart: typeof raw.weekStart === 'string' ? raw.weekStart : '',
			today: toNumber(raw.today),
			week: toNumber(raw.week),
			total: toNumber(raw.total),
			daily,
			lastScanAt: Number.isNaN(lastScanAt) ? null : new Date(lastScanAt).toISOString(),
			updatedAt: Number.isNaN(updatedAt) || updatedAt <= 0 ? new Date(0).toISOString() : new Date(updatedAt).toISOString(),
			demo: raw.demo === true,
			imported: raw.imported === true,
		};
	}

	function totalsFor(customer) {
		const now = new Date();
		const todayKey = dateKey(now);
		const weekStartKey = dateKey(startOfWeekDate(now));
		const daily = customer.daily || {};
		const dailyKeys = Object.keys(daily);
		let today = 0;
		let week = 0;

		dailyKeys.forEach((key) => {
			const value = toNumber(daily[key]);
			if (key === todayKey) today += value;
			if (key >= weekStartKey && key <= todayKey) week += value;
		});

		// A snapshot from an older app version may not have the daily map.
		if (dailyKeys.length === 0) {
			today = customer.day === todayKey ? customer.today : 0;
			week = customer.weekStart === weekStartKey ? customer.week : 0;
		}

		return { today, week, total: customer.total };
	}

	function sortedCustomers() {
		const list = [...customers.values()];
		const sort = els.customerSort.value;

		list.sort((a, b) => {
			const aTotals = totalsFor(a);
			const bTotals = totalsFor(b);

			if (sort === 'today') {
				return bTotals.today - aTotals.today || bTotals.week - aTotals.week || a.customer.localeCompare(b.customer);
			}
			if (sort === 'total') {
				return bTotals.total - aTotals.total || a.customer.localeCompare(b.customer);
			}
			if (sort === 'last') {
				const aLast = a.lastScanAt ? new Date(a.lastScanAt).getTime() : 0;
				const bLast = b.lastScanAt ? new Date(b.lastScanAt).getTime() : 0;
				return bLast - aLast || a.customer.localeCompare(b.customer);
			}
			if (sort === 'name') {
				return a.customer.localeCompare(b.customer);
			}
			return bTotals.week - aTotals.week || bTotals.total - aTotals.total || a.customer.localeCompare(b.customer);
		});

		return list;
	}

	function filteredCustomers() {
		const query = els.customerSearch.value.trim().toLowerCase();
		const list = sortedCustomers();
		if (!query) return list;
		return list.filter((customer) => {
			return customer.customer.toLowerCase().includes(query) || customer.accountId.toLowerCase().includes(query);
		});
	}

	function saveCache() {
		try {
			const list = [...customers.values()]
				.filter((customer) => !customer.demo || customer.imported)
				.slice(0, MAX_CACHED_CUSTOMERS);
			localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), customers: list }));
		} catch (error) {
			console.warn('Dashboard cache could not be saved:', error.message);
		}
	}

	function scheduleSave() {
		clearTimeout(saveTimer);
		saveTimer = setTimeout(saveCache, 250);
	}

	function loadCache() {
		try {
			const text = localStorage.getItem(CACHE_KEY);
			if (!text) return;
			const cached = JSON.parse(text);
			if (!cached || !Array.isArray(cached.customers)) return;

			cached.customers.slice(0, MAX_CACHED_CUSTOMERS).forEach((raw) => {
				const snapshot = normalizeSnapshot(raw, raw.accountId);
				if (snapshot) customers.set(snapshot.accountId, snapshot);
			});
		} catch (error) {
			console.warn('Dashboard cache could not be read:', error.message);
		}
	}

	function applySnapshot(raw, topicAccountId) {
		const snapshot = normalizeSnapshot(raw, topicAccountId);
		if (!snapshot) return;

		if (!snapshot.demo) clearDemoData({ manual: false });

		const existing = customers.get(snapshot.accountId);
		if (existing) {
			const existingTime = new Date(existing.updatedAt).getTime();
			const incomingTime = new Date(snapshot.updatedAt).getTime();
			if (existingTime > incomingTime) return;
		}

		customers.set(snapshot.accountId, snapshot);
		scheduleSave();
		scheduleRender();
	}

	function removeSnapshot(accountId) {
		if (!accountId || !customers.has(accountId)) return;
		customers.delete(accountId);
		if (selectedAccountId === accountId) closeDialog();
		scheduleSave();
		scheduleRender();
	}

	function handleScanEvent(raw) {
		if (!raw || typeof raw !== 'object') return;

		const bottles = toNumber(raw.bottles);
		if (bottles <= 0) return;

		if (raw.demo !== true) clearDemoData({ manual: false });

		const fallbackId = [raw.accountId || '', raw.scannedAt || '', bottles].join('|');
		const eventId = String(raw.eventId || fallbackId).slice(0, 120);
		if (events.some((event) => event.eventId === eventId)) return;

		const scannedAt = new Date(raw.scannedAt || Date.now()).getTime();
		events.unshift({
			eventId,
			accountId: String(raw.accountId || '').slice(0, 80),
			customer: String(raw.customer || 'Customer').trim().slice(0, 80) || 'Customer',
			bottles,
			scannedAt: Number.isNaN(scannedAt) ? new Date().toISOString() : new Date(scannedAt).toISOString(),
		});

		if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
		scheduleRender();
	}

	// ---------- Render ----------
	function scheduleRender() {
		clearTimeout(renderTimer);
		renderTimer = setTimeout(render, 60);
	}

	function render() {
		renderSummary();
		renderTrend();
		renderCustomers();
		renderActivity();
		if (selectedAccountId && els.dialog.open) renderDialog();
	}

	function renderSummary() {
		const list = [...customers.values()];
		let today = 0;
		let week = 0;
		let total = 0;
		let active = 0;
		let latestUpdate = 0;

		list.forEach((customer) => {
			const totals = totalsFor(customer);
			today += totals.today;
			week += totals.week;
			total += totals.total;
			if (totals.today > 0) active += 1;

			const updated = new Date(customer.updatedAt).getTime();
			if (!Number.isNaN(updated) && updated > latestUpdate) latestUpdate = updated;
		});

		els.statToday.textContent = formatNumber(today);
		els.statWeek.textContent = formatNumber(week);
		els.statActive.textContent = formatNumber(active);
		els.statTotal.textContent = formatNumber(total);

		els.statWeekNote.textContent = 'Since Monday, ' + formatDayShort(startOfWeekDate(new Date()));

		els.statTotalNote.hidden = list.length > 0;
		els.statTotalNote.textContent = list.length > 0 ? '' : 'Waiting for data';

		if (latestUpdate > 0) {
			els.statUpdated.textContent = formatTime(latestUpdate);
			els.statUpdatedNote.textContent = '';
			els.statUpdatedNote.hidden = true;
		} else {
			els.statUpdated.textContent = '\u2014';
			els.statUpdatedNote.textContent = 'Waiting for data';
			els.statUpdatedNote.hidden = false;
		}
	}

	function renderTrend() {
		const days = lastDays(trendRange);
		const values = new Map();
		const todayKey = dateKey(new Date());

		customers.forEach((customer) => {
			const daily = customer.daily || {};
			const dailyKeys = Object.keys(daily);

			// Older snapshots may only carry today's total instead of a
			// per-day map, so place that total on its own day.
			if (dailyKeys.length === 0) {
				if (customer.day === todayKey) {
					values.set(todayKey, (values.get(todayKey) || 0) + toNumber(customer.today));
				}
				return;
			}

			dailyKeys.forEach((key) => {
				const value = toNumber(daily[key]);
				if (value > 0) values.set(key, (values.get(key) || 0) + value);
			});
		});

		const points = days.map((day) => {
			const key = dateKey(day);
			return { day, value: values.get(key) || 0 };
		});

		const total = points.reduce((sum, point) => sum + point.value, 0);
		const max = Math.max(1, ...points.map((point) => point.value));
		const peak = points.reduce((best, point) => (point.value > best.value ? point : best), points[0]);
		const peakIndex = points.indexOf(peak);
		const labelEvery = trendRange > 7 ? 7 : 1;

		els.trendTotal.textContent = formatNumber(total);
		els.trendAverage.textContent = formatNumber(total / days.length);
		els.trendPeak.textContent = peak && peak.value > 0
			? formatDayShort(peak.day) + ' \u00b7 ' + formatNumber(peak.value)
			: '\u2014';

		els.trendChart.textContent = '';
		els.trendChart.hidden = total === 0;
		els.trendEmpty.hidden = total > 0;

		if (total === 0) {
			els.trendChart.setAttribute('aria-label', 'No bottles recorded in the last ' + trendRange + ' days');
			return;
		}

		els.trendChart.setAttribute('aria-label', 'Daily bottle counts for the last ' + trendRange + ' days');

		points.forEach((point, index) => {
			const day = document.createElement('div');
			day.className = 'trend-day';
			day.setAttribute('role', 'listitem');
			day.setAttribute('aria-label', formatLongDate(point.day) + ': ' + formatNumber(point.value) + ' bottles');
			day.title = formatLongDate(point.day) + ': ' + formatNumber(point.value) + ' bottles';
			if (index === peakIndex && point.value > 0) day.classList.add('is-peak');

			const area = document.createElement('div');
			area.className = 'trend-bar-area';

			const bar = document.createElement('span');
			bar.className = 'trend-bar';
			bar.style.height = point.value > 0
				? Math.max(3, Math.round((point.value / max) * 100)) + '%'
				: '0%';
			area.append(bar);

			const date = document.createElement('span');
			date.className = 'trend-date';
			date.setAttribute('aria-hidden', 'true');
			const isLast = index === points.length - 1;
			const showDate = trendRange > 7
				? isLast || (index % labelEvery === 0 && index < points.length - 2)
				: true;

			if (showDate) {
				date.textContent = trendRange > 7
					? formatDayShort(point.day)
					: point.day.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' });
				if (trendRange > 7 && index === 0) date.classList.add('trend-date-start');
				if (trendRange > 7 && isLast) date.classList.add('trend-date-end');
			}

			day.append(area, date);
			els.trendChart.append(day);
		});
	}

	function setEmpty(title, note) {
		els.emptyTitle.textContent = title;
		els.emptyNote.textContent = note;
	}

	function renderCustomers() {
		const allCustomers = [...customers.values()];
		const rows = filteredCustomers();
		const query = els.customerSearch.value.trim();

		els.customerRows.textContent = '';

		if (rows.length === 0) {
			els.customerTable.hidden = true;
			els.emptyState.hidden = false;

			if (allCustomers.length === 0) {
				setEmpty(
					'Waiting for the first scan',
					'Open the Recycle & Reward app on a phone and scan a QR code. The customer will appear here within a few seconds.'
				);
			} else if (query) {
				setEmpty(
					'No customer matches "' + query + '"',
					'Try another name, or clear the search to see every customer.'
				);
			} else {
				setEmpty('No customers yet', 'Customer snapshots will appear here when a phone publishes one.');
			}
			return;
		}

		els.customerTable.hidden = false;
		els.emptyState.hidden = true;

		rows.forEach((customer) => {
			const totals = totalsFor(customer);
			const row = document.createElement('tr');
			row.dataset.accountId = customer.accountId;

			const nameCell = document.createElement('td');
			const nameButton = document.createElement('button');
			nameButton.type = 'button';
			nameButton.className = 'customer-link';
			nameButton.dataset.accountId = customer.accountId;
			nameButton.setAttribute('aria-label', 'View bottle history for ' + customer.customer);

			const name = document.createElement('span');
			name.className = 'customer-name';
			name.textContent = customer.customer;

			nameButton.append(name);
			nameCell.append(nameButton);
			row.append(nameCell);

			[totals.today, totals.week, totals.total].forEach((value) => {
				const cell = document.createElement('td');
				cell.className = 'num';
				cell.textContent = formatNumber(value);
				row.append(cell);
			});

			const lastScanCell = document.createElement('td');
			lastScanCell.textContent = customer.lastScanAt ? formatDateTime(customer.lastScanAt) : 'No scans';
			row.append(lastScanCell);

			const statusCell = document.createElement('td');
			const badge = document.createElement('span');
			badge.className = 'badge';

			if (totals.today > 0) {
				badge.dataset.state = 'active';
				badge.textContent = 'Active today';
			} else if (totals.week > 0) {
				badge.dataset.state = 'week';
				badge.textContent = 'This week';
			} else {
				badge.dataset.state = 'idle';
				badge.textContent = 'Inactive';
			}

			statusCell.append(badge);
			row.append(statusCell);
			els.customerRows.append(row);
		});
	}

	function renderActivity() {
		els.activityCount.textContent = events.length + (events.length === 1 ? ' event' : ' events');
		els.activityEmpty.hidden = events.length > 0;
		els.activityList.textContent = '';

		events.forEach((event) => {
			const item = document.createElement('li');
			item.className = 'activity-item';

			const time = document.createElement('span');
			time.className = 'activity-time';
			time.textContent = formatTime(event.scannedAt);
			time.title = formatDateTime(event.scannedAt);

			const who = document.createElement('span');
			who.className = 'activity-who';
			const name = document.createElement('strong');
			name.textContent = event.customer;
			who.append(name, document.createTextNode(' scanned'));

			const amount = document.createElement('span');
			amount.className = 'activity-amount';
			amount.textContent = '+' + formatNumber(event.bottles) + (event.bottles === 1 ? ' bottle' : ' bottles');

			item.append(time, who, amount);
			els.activityList.append(item);
		});
	}

	function updateRangeButtons() {
		els.rangeButtons.forEach((button) => {
			button.setAttribute('aria-pressed', String(Number(button.dataset.range) === chartRange));
		});
	}

	function updateTrendButtons() {
		els.trendRangeButtons.forEach((button) => {
			button.setAttribute('aria-pressed', String(Number(button.dataset.trendRange) === trendRange));
		});
	}

	function renderDialog() {
		if (!selectedAccountId) return;
		const customer = customers.get(selectedAccountId);
		if (!customer) {
			closeDialog();
			return;
		}

		const totals = totalsFor(customer);
		els.dialogTitle.textContent = customer.customer;
		els.dialogToday.textContent = formatNumber(totals.today);
		els.dialogWeek.textContent = formatNumber(totals.week);
		els.dialogTotal.textContent = formatNumber(totals.total);

		const daily = customer.daily || {};
		const days = lastDays(chartRange);
		const values = days.map((day) => toNumber(daily[dateKey(day)]));
		const max = Math.max(1, ...values);

		els.customerChart.textContent = '';
		els.customerChart.setAttribute(
			'aria-label',
			'Daily bottle counts for ' + customer.customer + ', last ' + chartRange + ' days'
		);

		days.forEach((day, index) => {
			const value = values[index];
			const row = document.createElement('div');
			row.className = 'chart-row';
			row.setAttribute('role', 'listitem');
			row.setAttribute('aria-label', formatLongDate(day) + ': ' + formatNumber(value) + ' bottles');

			const date = document.createElement('span');
			date.className = 'chart-date';
			date.textContent = chartRange === 7
				? day.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
				: day.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

			const track = document.createElement('span');
			track.className = 'chart-track';
			const fill = document.createElement('span');
			fill.className = 'chart-fill';
			fill.style.width = value > 0 ? Math.max(2, Math.round((value / max) * 100)) + '%' : '0%';
			track.append(fill);

			const amount = document.createElement('span');
			amount.className = 'chart-value';
			amount.textContent = formatNumber(value);

			row.append(date, track, amount);
			els.customerChart.append(row);
		});

		els.dialogLastScan.textContent = customer.lastScanAt
			? 'Last scan: ' + formatDateTime(customer.lastScanAt) + ' (' + formatRelative(customer.lastScanAt) + ')'
			: 'No scans recorded yet.';
	}

	function openCustomer(accountId) {
		if (!customers.has(accountId)) return;
		selectedAccountId = accountId;
		renderDialog();

		if (typeof els.dialog.showModal === 'function') {
			if (!els.dialog.open) els.dialog.showModal();
		} else {
			els.dialog.setAttribute('open', '');
		}

		requestAnimationFrame(() => els.dialogCloseBtn.focus());
	}

	function closeDialog() {
		if (typeof els.dialog.close === 'function' && els.dialog.open) els.dialog.close();
		else els.dialog.removeAttribute('open');
		selectedAccountId = null;
	}

	// ---------- Sample data menu ----------
	function isDataMenuOpen() {
		return !!els.dataMenu && !els.dataMenu.hidden;
	}

	function openDataMenu(focusLast) {
		if (!els.dataMenu || !els.dataMenuBtn) return;
		els.dataMenu.hidden = false;
		els.dataMenuBtn.setAttribute('aria-expanded', 'true');
		const items = [...els.dataMenu.querySelectorAll('[role="menuitem"]')];
		const target = focusLast ? items[items.length - 1] : items[0];
		if (target) target.focus();
	}

	function closeDataMenu(options) {
		const settings = options || {};
		if (!els.dataMenu || !els.dataMenuBtn) return;
		const wasOpen = !els.dataMenu.hidden;
		els.dataMenu.hidden = true;
		els.dataMenuBtn.setAttribute('aria-expanded', 'false');
		if (settings.focusToggle && wasOpen) els.dataMenuBtn.focus();
	}

	function openResetDialog() {
		if (!els.resetDialog) return;

		if (typeof els.resetDialog.showModal === 'function') {
			if (!els.resetDialog.open) els.resetDialog.showModal();
		} else {
			els.resetDialog.setAttribute('open', '');
		}

		requestAnimationFrame(() => els.resetCancelBtn.focus());
	}

	function closeResetDialog(returnFocus) {
		if (!els.resetDialog) return;

		if (typeof els.resetDialog.close === 'function' && els.resetDialog.open) {
			els.resetDialog.close();
		} else {
			els.resetDialog.removeAttribute('open');
		}

		if (returnFocus) els.dataMenuBtn.focus();
	}

	function resetDashboard() {
		const brokerConnected = !!(mqttClient && mqttClient.connected);
		const accountIds = new Set(sessionAccountIds);

		[...customers.values()].forEach((customer) => {
			// Imported samples are included in case their ids overlap
			// with a retained broker snapshot.
			if (!customer.demo || customer.imported) accountIds.add(customer.accountId);
		});

		clearTimeout(saveTimer);
		clearTimeout(renderTimer);
		customers.clear();
		events.length = 0;
		sessionAccountIds = new Set();
		selectedAccountId = null;
		demoLoaded = false;
		chartRange = 7;
		trendRange = 7;

		try {
			localStorage.removeItem(CACHE_KEY);
			localStorage.setItem(DEMO_OFF_KEY, '1');
		} catch (_) {}

		els.customerSearch.value = '';
		els.customerSort.value = 'week';

		closeDialog();
		closeResetDialog();
		updateRangeButtons();
		updateTrendButtons();
		updateDemoUI();

		if (brokerConnected) {
			accountIds.forEach((accountId) => {
				mqttClient.publish(STATE_PREFIX + accountId, '', { qos: 1, retain: true }, (error) => {
					if (error) console.warn('Could not clear retained snapshot for ' + accountId + ':', error.message);
				});
			});
		}

		showImportStatus(
			brokerConnected
				? 'Dashboard reset. Local data and retained broker snapshots were cleared.'
				: 'Dashboard reset locally. Broker is offline, so retained snapshots were not cleared.',
			brokerConnected ? 'success' : 'error'
		);

		render();
		els.dataMenuBtn.focus();
	}

	// ---------- CSV ----------
	function csvCell(value) {
		return '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"';
	}

	function exportCsv() {
		const rows = [['Customer', 'Account', 'Today', 'This week', 'All-time', 'Last scan']];

		sortedCustomers().forEach((customer) => {
			const totals = totalsFor(customer);
			rows.push([
				customer.customer,
				customer.accountId,
				totals.today,
				totals.week,
				totals.total,
				customer.lastScanAt ? formatDateTime(customer.lastScanAt) : '',
			]);
		});

		const csv = '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
		const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = 'bottle-collection-' + dateKey(new Date()) + '.csv';
		document.body.append(link);
		link.click();
		link.remove();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	// ---------- Connection ----------
	function setConnection(state, text) {
		els.connectionPill.dataset.state = state;
		els.connectionText.textContent = text;
	}

	function startRetainedSync() {
		clearTimeout(retainedSyncTimer);
		sessionAccountIds = new Set();

		// Retained snapshots for every customer arrive right after the
		// subscription. Once they have had a moment to land, drop cached
		// customers the broker no longer has, including deleted accounts.
		retainedSyncTimer = setTimeout(() => {
			if (!mqttClient || !subscribed) return;

			let changed = false;
			[...customers.keys()].forEach((accountId) => {
				const customer = customers.get(accountId);
				if (customer && customer.demo) return;
				if (!sessionAccountIds.has(accountId)) {
					customers.delete(accountId);
					changed = true;
				}
			});

			if (selectedAccountId && !customers.has(selectedAccountId)) closeDialog();
			if (changed) {
				scheduleSave();
				scheduleRender();
			}
		}, 6000);
	}

	function connect() {
		if (!window.mqtt) {
			setConnection('error', 'MQTT did not load');
			return;
		}

		setConnection('connecting', 'Connecting');

		mqttClient = window.mqtt.connect(MQTT_CONFIG.url, {
			clientId: 'hafiz-dash-' + makeId(''),
			username: MQTT_CONFIG.username,
			password: MQTT_CONFIG.password,
			clean: true,
			reconnectPeriod: 4000,
			connectTimeout: 12000,
			keepalive: 30,
		});

		mqttClient.on('connect', () => {
			setConnection('online', 'Live');

			mqttClient.subscribe(MQTT_CONFIG.topicRoot + '/#', { qos: 1 }, (error) => {
				if (error) {
					console.warn('Dashboard subscription failed:', error.message);
					setConnection('error', 'Subscribe failed');
					return;
				}
				subscribed = true;
				startRetainedSync();
			});
		});

		mqttClient.on('reconnect', () => {
			subscribed = false;
			setConnection('connecting', 'Reconnecting');
		});

		mqttClient.on('close', () => {
			subscribed = false;
			setConnection('offline', 'Offline');
		});

		mqttClient.on('offline', () => {
			subscribed = false;
			setConnection('offline', 'Offline');
		});

		mqttClient.on('error', (error) => {
			console.warn('Dashboard connection error:', error.message);
			setConnection('error', 'Connection error');
		});

		mqttClient.on('message', (topic, payload) => {
			const text = payload.toString();

			if (topic.startsWith(STATE_PREFIX)) {
				const accountId = topic.slice(STATE_PREFIX.length);
				if (!accountId) return;

				if (!text.trim()) {
					removeSnapshot(accountId);
					return;
				}

				try {
					sessionAccountIds.add(accountId);
					applySnapshot(JSON.parse(text), accountId);
				} catch (error) {
					console.warn('Bad customer snapshot on ' + topic + ':', error.message);
				}
				return;
			}

			if (topic === EVENT_TOPIC) {
				if (!text.trim()) return;
				try {
					handleScanEvent(JSON.parse(text));
				} catch (error) {
					console.warn('Bad scan event:', error.message);
				}
			}
		});
	}

	// ---------- Theme ----------
	function applyTheme(theme) {
		const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
		const dark = theme === 'dark' || (theme === 'system' && prefersDark);

		document.documentElement.dataset.theme = dark ? 'dark' : 'light';
		els.themeToggle.setAttribute('aria-pressed', String(dark));
		els.themeToggle.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');

		const meta = document.querySelector('meta[name="theme-color"]');
		if (meta) meta.setAttribute('content', dark ? '#171610' : '#eef0d9');
	}

	try {
		const savedTheme = localStorage.getItem(THEME_KEY);
		if (savedTheme === 'light' || savedTheme === 'dark') themePreference = savedTheme;
	} catch (_) {}

	// ---------- Events ----------
	els.customerRows.addEventListener('click', (event) => {
		const button = event.target.closest('.customer-link');
		if (button) openCustomer(button.dataset.accountId);
	});

	els.customerSearch.addEventListener('input', renderCustomers);
	els.customerSort.addEventListener('change', renderCustomers);
	els.exportBtn.addEventListener('click', exportCsv);
	els.dialogCloseBtn.addEventListener('click', closeDialog);

	els.dataMenuBtn.addEventListener('click', () => {
		if (isDataMenuOpen()) closeDataMenu();
		else openDataMenu();
	});

	els.dataMenuBtn.addEventListener('keydown', (event) => {
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			openDataMenu(event.key === 'ArrowUp');
		}
	});

	els.dataMenu.addEventListener('keydown', (event) => {
		const items = [...els.dataMenu.querySelectorAll('[role="menuitem"]')];
		if (items.length === 0) return;
		const activeIndex = items.indexOf(document.activeElement);
		const currentIndex = activeIndex === -1 ? 0 : activeIndex;

		if (event.key === 'ArrowDown') {
			event.preventDefault();
			items[(currentIndex + 1) % items.length].focus();
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			items[(currentIndex - 1 + items.length) % items.length].focus();
		} else if (event.key === 'Home') {
			event.preventDefault();
			items[0].focus();
		} else if (event.key === 'End') {
			event.preventDefault();
			items[items.length - 1].focus();
		}
	});

	els.dataMenu.addEventListener('focusout', () => {
		setTimeout(() => {
			if (!isDataMenuOpen()) return;
			const active = document.activeElement;
			if (els.dataMenu.contains(active) || active === els.dataMenuBtn) return;
			closeDataMenu();
		}, 0);
	});

	document.addEventListener('click', (event) => {
		if (!isDataMenuOpen()) return;
		if (els.dataMenu.contains(event.target) || els.dataMenuBtn.contains(event.target)) return;
		closeDataMenu();
	});

	document.addEventListener('keydown', (event) => {
		if (event.key !== 'Escape' || !isDataMenuOpen()) return;
		event.preventDefault();
		closeDataMenu({ focusToggle: true });
	});

	els.importBtn.addEventListener('click', () => {
		closeDataMenu({ focusToggle: true });
		els.importInput.click();
	});

	els.importInput.addEventListener('change', () => {
		const file = els.importInput.files && els.importInput.files[0];
		if (file) handleImportFile(file);
	});

	els.demoBtn.addEventListener('click', () => {
		closeDataMenu({ focusToggle: true });
		if (demoLoaded) clearDemoData({ manual: true });
		else loadDemoData();
	});

	els.demoBannerBtn.addEventListener('click', () => clearDemoData({ manual: true }));

	els.resetBtn.addEventListener('click', () => {
		closeDataMenu({ focusToggle: true });
		openResetDialog();
	});

	els.resetCancelBtn.addEventListener('click', () => closeResetDialog(true));
	els.resetConfirmBtn.addEventListener('click', resetDashboard);

	els.resetDialog.addEventListener('click', (event) => {
		if (event.target === els.resetDialog) closeResetDialog(true);
	});

	els.resetDialog.addEventListener('cancel', (event) => {
		event.preventDefault();
		closeResetDialog(true);
	});

	els.dialog.addEventListener('click', (event) => {
		if (event.target === els.dialog) closeDialog();
	});

	els.dialog.addEventListener('close', () => {
		selectedAccountId = null;
	});

	els.rangeButtons.forEach((button) => {
		button.addEventListener('click', () => {
			chartRange = Number(button.dataset.range) === 30 ? 30 : 7;
			updateRangeButtons();
			renderDialog();
		});
	});

	els.trendRangeButtons.forEach((button) => {
		button.addEventListener('click', () => {
			trendRange = Number(button.dataset.trendRange) === 30 ? 30 : 7;
			updateTrendButtons();
			renderTrend();
		});
	});

	els.themeToggle.addEventListener('click', () => {
		const dark = document.documentElement.dataset.theme === 'dark';
		themePreference = dark ? 'light' : 'dark';
		try { localStorage.setItem(THEME_KEY, themePreference); } catch (_) {}
		applyTheme(themePreference);
	});

	window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
		if (themePreference === 'system') applyTheme('system');
	});

	// ---------- Init ----------
	applyTheme(themePreference);
	updateRangeButtons();
	updateTrendButtons();
	loadCache();

	demoLoaded = [...customers.values()].some((customer) => customer.demo);
	let demoBlocked = false;
	try { demoBlocked = localStorage.getItem(DEMO_OFF_KEY) === '1'; } catch (_) {}

	if (!demoBlocked && customers.size === 0) loadDemoData();
	else updateDemoUI();

	render();
	setInterval(renderSummary, 30000);
	connect();
});
