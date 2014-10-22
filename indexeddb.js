/*!
 * IndexedDB Wrapper
 * author: Stefan Benicke <stefan.benicke@gmail.com>
 * version: 0.0.1
 * license: MIT
 */
;(function(global) {
	'use strict';

	var indexedDB = window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB;
	var IDBTransaction = window.IDBTransaction || window.webkitIDBTransaction || window.msIDBTransaction;
	var IDBKeyRange = window.IDBKeyRange || window.webkitIDBKeyRange || window.msIDBKeyRange;

	var mode = {
		READ_ONLY : 'readonly',
		READ_WRITE : 'readwrite'
	};

	function Database(name, stores) {
		_defineOwnProperty(this, 'name', name);
		_defineOwnProperty(this, 'version', 0);
		_defineOwnProperty(this, 'stores', null);
		_defineOwnProperty(this, 'db', null);
		if (stores) {
			return this.initDatabase().then(this.createStore.bind(this, stores, null, null, 'schema'));
		}
		return this.initDatabase();
	}


	Database.all = function() {
		return new Promise(function(resolve, reject) {
			if (!('webkitGetDatabaseNames' in indexedDB)) {
				throw new Error('Unsopported');
			}
			var request = indexedDB.webkitGetDatabaseNames();
			request.addEventListener('success', function() {
				var names = _toArray(this.result);
				resolve(names);
			});
			request.addEventListener('error', function(error) {
				console.dir(error.stack);
				reject(error);
			});
		});
	};

	Database.prototype.initDatabase = function() {
		var self = this;
		return new Promise(function(resolve, reject) {
			self.close();
			var request = indexedDB.open(self.name);
			request.addEventListener('success', function() {
				_updateStoreInfo(self, self, this.result, resolve, reject);
			});
			request.addEventListener('error', function(error) {
				console.dir(error.stack);
				reject(error);
			});
			request.addEventListener('blocked', function(event) {
				console.dir(event);
				reject(event);
			});
		});
	};

	Database.prototype.deleteDatabase = function() {
		var self = this;
		return new Promise(function(resolve, reject) {
			self.close();
			var request = indexedDB.deleteDatabase(self.name);
			request.addEventListener('success', function() {
				self.stores = null;
				self.version = 0;
				resolve(self);
			});
			request.addEventListener('error', function(error) {
				console.error(error.stack);
				reject(error);
			});
			request.addEventListener('blocked', function(event) {
				console.error(event);
				reject(event);
			});
		});
	};

	Database.prototype.createStore = function(name, key, indexes, type) {
		var self = this;
		return new Promise(function(resolve, reject) {
			var stores = _cleanStoreObject(name, key, indexes);
			var differentStores = _getDifferentStores(self, stores);
			var removedStores = _getRemovedStores(self, stores, type);
			if (differentStores.length === 0 && removedStores.length === 0) {
				resolve(self);
				return;
			}
			self.close();
			var request = indexedDB.open(self.name, self.version + 1);
			request.addEventListener('upgradeneeded', function() {
				var db = this.result;
				var transaction = this.transaction;
				differentStores.forEach(function(store) {
					if (db.objectStoreNames.contains(store.name)) {
						var dbStore = _getdbStoreByName(self.stores, store.name);
						if (!_equalStoreKey(store.key, dbStore.key)) {
							db.deleteObjectStore(store.name);
							_createStore(db, store.name, store.key, store.indexes);
						} else {
							var differentIndexes = _getDifferentIndexes(dbStore.indexes, store.indexes);
							var removedIndexes = _getRemovedIndexes(dbStore.indexes, store.indexes);
							if (differentIndexes.length > 0 || removedIndexes.length > 0) {
								var openStore = transaction.objectStore(store.name);
								differentIndexes.forEach(function(index) {
									if (openStore.indexNames.contains(index.name)) {
										openStore.deleteIndex(index.name);
									}
									openStore.createIndex(index.name, index.keyPath || index.name, {
										unique : index.unique === true ? true : false,
										multiEntry : index.multiEntry === true ? true : false
									});
								});
								removedIndexes.forEach(function(index) {
									openStore.deleteIndex(index.name);
								});
							}
						}
					} else {
						_createStore(db, store.name, store.key, store.indexes);
					}
				});
				removedStores.forEach(function(store) {
					db.deleteObjectStore(store.name);
				});
			});
			request.addEventListener('success', function() {
				_updateStoreInfo(self, self, this.result, resolve, reject);
			});
			request.addEventListener('error', function(error) {
				console.error(error.stack);
				reject(error);
			});
		});
	};

	Database.prototype.deleteStore = function(names) {
		var self = this;
		if (!Array.isArray(names)) {
			names = [names];
		}
		names = names.filter(function(name) {
			return ! self.db.objectStoreNames.contains(name);
		});
		return new Promise(function(resolve, reject) {
			if (names.length === 0) {
				resolve(self);
				return;
			}
			self.close();
			var request = indexedDB.open(self.name, self.version + 1);
			request.addEventListener('upgradeneeded', function() {
				names.forEach(this.result.deleteObjectStore.bind(this.result));
			});
			request.addEventListener('success', function() {
				_updateStoreInfo(self, self, this.result, resolve, reject);
			});
			request.addEventListener('error', function(error) {
				console.error(error.stack);
				reject(error);
			});
		});
	};

	Database.prototype.close = function() {
		if (this.db !== null) {
			this.db.close();
			this.db = null;
		}
		return this;
	};

	Database.prototype.select = function(name, options) {
		if (this.db === null) {
			throw new Error('Uninitialised database');
		}
		if (! this.db.objectStoreNames.contains(name)) {
			throw new Error('Store does not exist');
		}
		return new DatabaseStore(this, name, options);
	};

	function DatabaseStore(database, name, options) {
		_defineOwnProperty(this, 'database', database);
		_defineOwnProperty(this, 'name', name);
		_defineOwnProperty(this, 'options', _extend({
			returnValues : false
		}, options));
		_defineOwnProperty(this, 'bounds', {
			from : null,
			until : null,
			excludeFrom : false,
			excludeUntil : false
		});
	}


	DatabaseStore.prototype.from = function(value, excluded) {
		this.bounds.from = value;
		if (excluded === true) {
			this.bounds.excludeFrom = true;
		}
		return this;
	};

	DatabaseStore.prototype.until = function(value, excluded) {
		this.bounds.until = value;
		if (excluded === true) {
			this.bounds.excludeUntil = true;
		}
		return this;
	};

	DatabaseStore.prototype.range = function(from, until, excludeFrom, excludeUntil) {
		this.bounds.from = from;
		this.bounds.until = until;
		if (excludeFrom === true) {
			this.bounds.excludeFrom = true;
		}
		if (excludeUntil === true) {
			this.bounds.excludeUntil = true;
		}
		return this;
	};

	DatabaseStore.prototype.createIndex = function(index) {
		var self = this;
		return new Promise(function(resolve, reject) {
			if (!( index instanceof Object && index.name)) {
				throw new Error('Invalid argument index');
			}
			self.database.close();
			var request = indexedDB.open(self.database.name, self.database.version + 1);
			request.addEventListener('upgradeneeded', function() {
				var db = this.result;
				var transaction = this.transaction;
				var store = transaction.objectStore(self.name);
				if (store.indexNames.contains(index.name)) {
					store.deleteIndex(index.name);
				}
				store.createIndex(index.name, index.keyPath || index.name, {
					unique : index.unique === true ? true : false,
					multiEntry : index.multiEntry === true ? true : false
				});

			});
			request.addEventListener('success', function() {
				_updateStoreInfo(self, self.database, this.result, resolve, reject);
			});
			request.addEventListener('error', function(error) {
				console.error(error.stack);
				reject(error);
			});
		});
	};

	DatabaseStore.prototype.deleteIndex = function(indexName) {
		var self = this;
		return new Promise(function(resolve, reject) {
			if (!indexName) {
				throw new Error('Invalid argument indexName');
			}
			var storeProperties = _getdbStoreByName(self.name);
			var exist = storeProperties.indexes.some(function(index) {
				return index.name === indexName;
			});
			if (!exist) {
				resolve(self);
				return;
			}
			self.database.close();
			var request = indexedDB.open(self.name, self.version + 1);
			request.addEventListener('upgradeneeded', function() {
				var db = this.result;
				var transaction = this.transaction;
				var store = transaction.objectStore(self.name);
				if (store.indexNames.contains(index.name)) {
					store.deleteIndex(index.name);
				}
			});
			request.addEventListener('success', function() {
				_updateStoreInfo(self, self.database, this.result, resolve, reject);
			});
			request.addEventListener('error', function(error) {
				console.error(error.stack);
				reject(error);
			});
		});
	};

	DatabaseStore.prototype.add = function() {//entries
		var entries = _toArray(arguments).filter(function(arg) {
			return arg instanceof Object;
		});
		var self = this;
		return new Promise(function(resolve, reject) {
			var result = [];
			var transaction = self.database.db.transaction(self.name, mode.READ_WRITE);
			_initTransaction(transaction, result, resolve, reject);
			var store = transaction.objectStore(self.name);
			entries.forEach(function(entry) {
				var request;
				if (store.keyPath === null && store.autoIncremet === false && !(entry.item && entry.key)) {
					console.error('missing key', entry);
					return;
				}
				if (entry.item && entry.key) {
					var key = entry.key;
					entry = entry.item;
					request = store.add(entry, key);
				} else {
					request = store.add(entry);
				}
				request.addEventListener('success', function() {
					if (self.options.returnValues === true) {
						_addKey(this.source, entry, this.result);
						result.push(entry);
					} else {
						result.push(this.result);
					}
				});
				request.addEventListener('error', _requestError);
			});
		});
	};

	DatabaseStore.prototype.update = function(key, update) {
		var self = this;
		return new Promise(function(resolve, reject) {
			var result = [];
			var transaction = self.database.db.transaction(self.name, mode.READ_WRITE);
			_initTransaction(transaction, result, resolve, reject);
			var store = transaction.objectStore(self.name);
			var cursorRequest;
			if (_boundsSet(self.bounds)) {
				cursorRequest = _openCursor(store, self.bounds);
				update = key;
			} else {
				if (update) {
					var range = IDBKeyRange.only(key);
					cursorRequest = store.openCursor(range);
				} else {
					cursorRequest = store.openCursor();
					update = key;
				}
			}
			cursorRequest.addEventListener('success', function() {
				if (this.result === null || this.result === undefined) {
					return;
				}
				var updateEntry = this.result.value;
				if ( update instanceof Function) {
					updateEntry = update(updateEntry);
				} else if ( update instanceof Object) {
					updateEntry = _extend(updateEntry, update);
				}
				var updateRequest = this.result.update(updateEntry);
				updateRequest.addEventListener('success', function() {
					if (self.options.returnValues === true) {
						var entry = this.source.value;
						_addKey(this.source.source, entry, this.source.primaryKey, (this.source.key === this.source.primaryKey));
						result.push(entry);
					} else {
						result.push(this.source.key);
					}
				});
				this.result.continue();
			});
			cursorRequest.addEventListener('error', _requestError);
		});
	};

	DatabaseStore.prototype.replace = function() {// entries
		var entries = _toArray(arguments).filter(function(arg) {
			return arg instanceof Object;
		});
		var self = this;
		return new Promise(function(resolve, reject) {
			var result = [];
			var transaction = self.database.db.transaction(self.name, mode.READ_WRITE);
			_initTransaction(transaction, result, resolve, reject);
			var store = transaction.objectStore(self.name);
			entries.forEach(function(entry) {
				var request;
				if (store.keyPath === null && store.autoIncrement === false && !(entry.item && entry.key)) {
					console.error('missing key', entry);
					return;
				}
				if (entry.item && entry.key) {
					var key = entry.key;
					entry = entry.item;
					request = store.put(entry, key);
				} else {
					request = store.put(entry);
				}
				request.addEventListener('success', function() {
					if (self.options.returnValues === true) {
						_addKey(this.source, entry, this.result);
						result.push(entry);
					} else {
						result.push(this.result);
					}
				});
				request.addEventListener('error', _requestError);
			});
		});
	};

	DatabaseStore.prototype.get = function() {// keys
		var keys = _toArray(arguments);
		if (keys.length === 0 || _boundsSet(this.bounds)) {
			return this.all();
		}
		var self = this;
		return new Promise(function(resolve, reject) {
			var result = [];
			var transaction = self.database.db.transaction(self.name, mode.READ_ONLY);
			_initTransaction(transaction, result, resolve, reject);
			var store = transaction.objectStore(self.name);
			keys.forEach(function(key) {
				var request = store.get(key);
				request.addEventListener('success', function() {
					if (this.result === null || this.result === undefined) {
						return;
					}
					var entry = this.result;
					_addKey(this.source, entry, key);
					result.push(entry);
				});
				request.addEventListener('error', _requestError);
			});
		});
	};

	DatabaseStore.prototype.all = function() {
		var self = this;
		return new Promise(function(resolve, reject) {
			var result = [];
			var transaction = self.database.db.transaction(self.name, mode.READ_ONLY);
			_initTransaction(transaction, result, resolve, reject);
			var store = transaction.objectStore(self.name);
			var cursorRequest = _openCursor(store, self.bounds);
			cursorRequest.addEventListener('success', function() {
				if (this.result === null || this.result === undefined) {
					return;
				}
				var entry = this.result.value;
				_addKey(this.result.source, entry, this.result.primaryKey);
				result.push(entry);
				this.result.continue();
			});
			cursorRequest.addEventListener('error', _requestError);
		});
	};

	DatabaseStore.prototype.remove = function() {// keys
		var keys = _toArray(arguments);
		if (keys.length === 0 && ! _boundsSet(this.bounds)) {
			return this.clear();
		}
		var self = this;
		return new Promise(function(resolve, reject) {
			var result = [];
			var transaction = self.database.db.transaction(self.name, mode.READ_WRITE);
			_initTransaction(transaction, result, resolve, reject);
			var store = transaction.objectStore(self.name);

			if (keys.length === 0 && _boundsSet(self.bounds)) {
				var cursorRequest = _openCursor(store, self.bounds);
				cursorRequest.addEventListener('success', function() {
					if (this.result === null || this.result === undefined) {
						return;
					}
					var deleteRequest = this.result.delete(this.result.value);
					deleteRequest.addEventListener('success', function() {
						if (self.options.returnValues === true) {
							var entry = this.source.value;
							_addKey(this.source.source, entry, this.source.primaryKey);
							result.push(entry);
						} else {
							reslt.push(this.source.key);
						}
					});
					this.result.continue();
				});
				cursorRequest.addEventListener('error', _requestError);
			} else {
				keys.forEach(function(key) {
					var range = IDBKeyRange.only(key);
					var cursorRequest = store.openCursor(range);
					cursorRequest.addEventListener('success', function() {
						if (this.result === null || this.result === undefined) {
							return;
						}
						var deleteRequest = this.result.delete(this.result.value);
						deleteRequest.addEventListener('success', function() {
							if (self.options.returnValues === true) {
								result.push(this.source.value);
							} else {
								result.push(this.source.key);
							}
						});
						this.result.continue();
					});
					cursorRequest.addEventListener('error', function(error) {
						console.error(error.stack);
					});
				});
			}
		});
	};

	DatabaseStore.prototype.clear = function() {
		var self = this;
		return new Promise(function(resolve, reject) {
			var transaction = self.database.db.transaction(self.name, mode.READ_WRITE);
			_initTransaction(transaction, self, resolve, reject);
			var store = transaction.objectStore(self.name);
			store.clear();
		});
	};

	DatabaseStore.prototype.index = function(name, options) {
		return new DatabaseIndex(this, name, options);
	};

	function DatabaseIndex(store, name, options) {
		_defineOwnProperty(this, 'store', store);
		_defineOwnProperty(this, 'name', name);
		_defineOwnProperty(this, 'options', _extend({
			returnValues : false
		}, options));
		_defineOwnProperty(this, 'bounds', {
			from : null,
			until : null,
			excludeFrom : false,
			excludeUntil : false
		});
	}


	DatabaseIndex.prototype.from = DatabaseStore.prototype.from;
	DatabaseIndex.prototype.until = DatabaseStore.prototype.until;
	DatabaseIndex.prototype.range = DatabaseStore.prototype.range;

	DatabaseIndex.prototype.update = function(key, update) {
		var self = this;
		return new Promise(function(resolve, reject) {
			var result = [];
			var transaction = self.store.database.db.transaction(self.store.name, mode.READ_WRITE);
			_initTransaction(transaction, result, resolve, reject);
			var store = transaction.objectStore(self.store.name);
			var storeIndex = store.index(self.name);
			var cursorRequest;
			if (_boundsSet(self.bounds)) {
				cursorRequest = _openCursor(storeIndex, self.bounds);
				update = key;
			} else {
				if (update) {
					var range = IDBKeyRange.only(key);
					cursorRequest = storeIndex.openCursor(range);
				} else {
					cursorRequest = storeIndex.openCursor();
					update = key;
				}
			}
			cursorRequest.addEventListener('success', function() {
				if (this.result === null || this.result === undefined) {
					return;
				}
				var updateEntry = this.result.value;
				if ( update instanceof Function) {
					updateEntry = update(updateEntry);
				} else if ( update instanceof Object) {
					updateEntry = _extend(updateEntry, update);
				}
				var updateRequest = this.result.update(updateEntry);
				updateRequest.addEventListener('success', function() {
					if (self.options.returnValues === true) {
						var entry = this.source.value;
						_addKey(this.source.source, entry, this.source.primaryKey, (this.source.key === this.source.primaryKey));
						result.push(entry);
					} else {
						result.push(this.source.key);
					}
				});
				this.result.continue();
			});
			cursorRequest.addEventListener('error', _requestError);
		});
	};

	DatabaseIndex.prototype.get = function() {// values
		var values = _toArray(arguments);
		if (values.length === 0 || _boundsSet(this.bounds)) {
			return this.all();
		}
		var self = this;
		return new Promise(function(resolve, reject) {
			var result = [];
			var transaction = self.store.database.db.transaction(self.store.name, mode.READ_ONLY);
			_initTransaction(transaction, result, resolve, reject);
			var store = transaction.objectStore(self.store.name);
			var storeIndex = store.index(self.name);
			values.forEach(function(value) {
				var range = IDBKeyRange.only(value);
				var cursorRequest = storeIndex.openCursor(range);
				cursorRequest.addEventListener('success', function() {
					if (this.result === null || this.result === undefined) {
						return;
					}
					var entry = this.result.value;
					_addKey(this.result.source, entry, this.result.primaryKey, (this.result.key === this.result.primaryKey));
					result.push(entry);
					this.result.continue();
				});
				cursorRequest.addEventListener('error', _requestError);
			});
		});
	};

	DatabaseIndex.prototype.all = function() {
		var self = this;
		return new Promise(function(resolve, reject) {
			var result = [];
			var transaction = self.store.database.db.transaction(self.store.name, mode.READ_ONLY);
			_initTransaction(transaction, result, resolve, reject);
			var store = transaction.objectStore(self.store.name);
			var storeIndex = store.index(self.name);
			var cursorRequest = _openCursor(storeIndex, self.bounds);
			cursorRequest.addEventListener('success', function() {
				if (this.result === null || this.result === undefined) {
					return;
				}
				var entry = this.result.value;
				_addKey(this.result.source, entry, this.result.primaryKey, (this.result.key === this.result.primaryKey));
				result.push(entry);
				this.result.continue();
			});
			cursorRequest.addEventListener('error', _requestError);
		});
	};

	DatabaseIndex.prototype.remove = function() {// keys
		var keys = _toArray(arguments);
		var self = this;
		return new Promise(function(resolve, reject) {
			var result = [];
			var transaction = self.store.database.db.transaction(self.store.name, mode.READ_WRITE);
			_initTransaction(transaction, result, resolve, reject);
			var store = transaction.objectStore(self.store.name);
			var storeIndex = store.index(self.name);
			if (keys.length === 0 || _boundsSet(self.bounds)) {
				var cursorRequest = _openCursor(storeIndex, self.bounds);
				cursorRequest.addEventListener('success', function() {
					if (this.result === null || this.result === undefined) {
						return;
					}
					var deleteRequest = this.result.delete(this.result.value);
					deleteRequest.addEventListener('success', function() {
						if (self.options.returnValues === true) {
							result.push(this.source.value);
						} else {
							result.push(this.source.key);
						}
					});
					this.result.continue();
				});
				cursorRequest.addEventListener('error', function() {
					console.error(error.stack);
				});
			} else {
				keys.forEach(function(key) {
					var range = IDBKeyRange.only(key);
					var cursorRequest = storeIndex.openCursor(range);
					cursorRequest.addEventListener('success', function() {
						if (this.result === null || this.result === undefined) {
							return;
						}
						var deleteRequest = this.result.delete(this.result.value);
						deleteRequest.addEventListener('success', function() {
							if (self.options.returnValues === true) {
								result.push(this.source.value);
							} else {
								result.push(this.source.key);
							}
						});
						this.result.continue();
					});
					cursorRequest.addEventListener('error', function(error) {
						console.error(error.stack);
					});
				});
			}
		});
	};

	function _updateStoreInfo(self, database, db, resolve, reject) {
		var storeNames = _toArray(db.objectStoreNames);
		database.db = db;
		database.stores = [];
		database.version = db.version;
		if (storeNames.length > 0) {
			var transaction = db.transaction(storeNames, mode.READ_ONLY);
			_initTransaction(transaction, self, resolve, reject);
			database.stores = storeNames.map(function(name) {
				var store = transaction.objectStore(name);
				var info = {
					name : store.name,
					key : {
						keyPath : typeof store.keyPath === 'string' ? store.keyPath : _toArray(store.keyPath),
						autoIncrement : store.autoIncrement
					},
					indexes : []
				};
				info.indexes = _toArray(store.indexNames).map(function(indexName) {
					var index = store.index(indexName);
					return {
						name : index.name,
						keyPath : typeof index.keyPath === 'string' ? index.keyPath : _toArray(index.keyPath),
						unique : index.unique,
						multiEntry : index.multiEntry
					};
				});
				return info;
			});
		} else {
			resolve(self);
		}
	}

	function _createStore(db, name, key, indexes) {
		var store = db.createObjectStore(name, key);
		if (Array.isArray(indexes)) {
			indexes.forEach(function(index) {
				store.createIndex(index.name, index.keyPath || index.name, {
					unique : index.unique === true ? true : false,
					multiEntry : index.multiEntry === true ? true : false
				});
			});
		}
	}

	function _cleanStoreObject(list, key, indexes) {
		if ( typeof list === 'string') {
			list = [{
				name : list,
				key : key || null,
				indexes : Array.isArray(indexes) ? indexes : []
			}];
		}
		if (Array.isArray(list)) {
			return list.filter(function(store) {
				if (!store.name) {
					return false;
				}
				if (!store.key) {
					store.key = {
						keyPath : null,
						autoIncrement : false
					};
				} else {
					if (!(Array.isArray(store.key.keyPath) || typeof store.key.keyPath === 'string') || store.key.keyPath === '') {
						store.key.keyPath = null;
					}
					if (store.key.autoIncrement === undefined) {
						store.key.autoIncrement = false;
					}
				}
				if (!store.indexes) {
					store.indexes = [];
				} else {
					store.indexes = store.indexes.filter(function(index) {
						if (!index.name) {
							return false;
						}
						if (!(Array.isArray(index.keyPath) || typeof index.keyPath === 'string') || index.keyPath === '') {
							index.keyPath = index.name;
						}
						if (index.unique === undefined) {
							index.unique = false;
						}
						if (index.multiEntry === undefined) {
							index.multiEntry = false;
						}
						return true;
					});
				}
				return true;
			});
		}
		return [];
	}

	function _getDifferentStores(database, stores) {
		return stores.filter(function(store) {
			if (database.stores.some(function(dbStore) {
				if (dbStore.name !== store.name) {
					return false;
				}
				if (!_equalStoreKey(dbStore.key, store.key)) {
					return false;
				}
				var differentIndexes = _getDifferentIndexes(dbStore.indexes, store.indexes);
				if (differentIndexes.length > 0) {
					return false;
				}
				if (dbStore.indexes.length !== store.indexes.length) {
					return false;
				}
				return true;
			})) {
				return false;
			}
			return true;
		});
	}

	function _equalStoreKey(keyA, keyB) {
		if (!((Array.isArray(keyA.keyPath) && Array.isArray(keyB.keyPath) && _arrayEqual(keyA.keyPath, keyB.keyPath)) || ( typeof keyA.keyPath === 'string' && typeof keyB.keyPath === 'string' && keyA.keyPath === keyB.keyPath) || (keyA.keyPath === null && keyB.keyPath === null))) {
			return false;
		}
		if (keyA.autoIncrement !== keyB.autoIncrement) {
			return false;
		}
		return true;
	}

	function _getDifferentIndexes(indexesA, indexesB) {
		return indexesB.filter(function(iB) {
			if (indexesA.some(function(iA) {
				if (iA.name !== iB.name) {
					return false;
				}
				if (!((Array.isArray(iA.keyPath) && Array.isArray(iB.keyPath) && _arrayEqual(iA.keyPath, iB.keyPath)) || ( typeof iA.keyPath === 'string' && typeof iB.keyPath === 'string' && iA.keyPath === iB.keyPath))) {
					return false;
				}
				if (iA.unique !== iB.unique) {
					return false;
				}
				if (iA.multiEntry !== iB.multiEntry) {
					return false;
				}
				return true;
			})) {
				return false;
			}
			return true;
		});
	}

	function _getRemovedStores(database, stores, type) {
		if (type === 'schema' && database.stores.length > stores.length) {
			return database.stores.filter(function(dbStore) {
				return ! stores.some(function(store) {
					return store.name === dbStore.name;
				});
			});
		}
		return [];
	}

	function _getRemovedIndexes(dbStoreIndexes, indexes) {
		if (dbStoreIndexes.length > indexes.length) {
			return dbStoreIndexes.filter(function(dbStoreIndex) {
				return ! indexes.some(function(index) {
					return index.name === dbStoreIndex.name;
				});
			});
		}
		return [];
	}

	function _getdbStoreByName(stores, name) {
		for (var i = 0; i < stores.length; i++) {
			if (stores[i].name === name) {
				return stores[i];
			}
		}
		return null;
	}

	function _openCursor(store, bounds) {
		var range = null;
		if (bounds.from !== null && bounds.until !== null) {
			range = IDBKeyRange.bound(bounds.from, bounds.until, bounds.excludeFrom, bounds.excludeUntil);
		} else if (bounds.from !== null) {
			range = IDBKeyRange.lowerBound(bounds.from, bounds.excludeFrom);
		} else if (bounds.until !== null) {
			range = IDBKeyRange.upperBound(bounds.until, bounds.excludeUntil);
		}
		_resetBounds(bounds);
		if (range !== null) {
			return store.openCursor(range);
		}
		return store.openCursor();
	}

	function _boundsSet(bounds) {
		return (bounds.from !== null || bounds.until !== null);
	}

	function _resetBounds(bounds) {
		bounds.from = null;
		bounds.until = null;
		bounds.excludeFrom = false;
		bounds.excludeUntil = false;
	}

	function _initTransaction(transaction, result, resolve, reject) {
		transaction.addEventListener('complete', function() {
			resolve(result);
		});
		transaction.addEventListener('error', function(error) {
			console.error(error.stack);
			reject(error);
		});
		transaction.addEventListener('abort', function(event) {
			console.dir(event);
			reject(event);
		});
	}

	function _requestError(error) {
		console.error(error.stack);
	}

	function _addKey(source, entry, key, differ) {
		if (source.keyPath === null || differ) {
			Object.defineProperty(entry, '__id__', {
				value : key,
				enumerable : false
			});
		} else if (source.keyPath !== null && entry[source.keyPath] === undefined) {
			entry[source.keyPath] = key;
		}
	}

	function _defineOwnProperty(object, key, value) {
		Object.defineProperty(object, key, {
			value : value,
			enumerable : false,
			writable : true
		});
	}

	function _extend(target, object) {
		for (var key in object) {
			if (object.hasOwnProperty(key)) {
				target[key] = object[key];
			}
		}
		return target;
	}

	function _toArray(list) {
		if (list === undefined || list === null) {
			return list;
		}
		return Array.prototype.slice.call(list);
	}

	function _arrayEqual(source, target) {
		if (source.length !== target.length) {
			return false;
		}
		return source.every(function(entry) {
			return target.indexOf(entry) > -1;
		});
	}

	if ( typeof define === 'function' && define.amd) {
		define(function() {
			return Database;
		});
	} else {
		global.Database = Database;
	}

})(this);
