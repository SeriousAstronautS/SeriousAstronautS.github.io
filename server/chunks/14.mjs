function _mergeNamespaces(n, m) {
	for (var i = 0; i < m.length; i++) {
		const e = m[i];
		if (typeof e !== 'string' && !Array.isArray(e)) { for (const k in e) {
			if (k !== 'default' && !(k in n)) {
				const d = Object.getOwnPropertyDescriptor(e, k);
				if (d) {
					Object.defineProperty(n, k, d.get ? d : {
						enumerable: true,
						get: function () { return e[k]; }
					});
				}
			}
		} }
	}
	return Object.freeze(n);
}

var _14$1 = {};

var ids = _14$1.ids = [14];
var modules = _14$1.modules = {
  68: function(module) {
    module.exports = JSON.parse('[{"id":1,"time":["00:00","06:00"],"title":"\u041F\u0440\u043E\u0441\u043C\u043E\u0442\u0440 \u0444\u0438\u043B\u044C\u043C\u0430 \u{1F3A5}","userName":"\u041D\u0438\u043A\u0438\u0442\u0430 \u0411\u0443\u043B\u0430\u043D\u043E\u0432","date":"2023-06-29","color":"blue","darkColor":"sky","userId":2},{"id":2,"time":["04:00","08:00"],"title":"\u0411\u043E\u0442\u0430\u0435\u043C","userName":"\u0422\u0438\u043C\u0443\u0440 \u0421\u0435\u043B\u0438\u043D","date":"2023-06-30","color":"purple","darkColor":"fuchsia","userId":1},{"id":3,"time":["03:00","07:00"],"title":"\u041F\u0440\u043E\u0433\u0430\u0435\u043C \u0441\u0430\u0439\u0442","userName":"\u0420\u0435\u043D\u0430\u0442\u0430 \u041A\u043E\u0441\u0442\u043E\u043B\u0438\u043D\u0430","date":"2023-07-01","color":"pink","darkColor":"indigo","userId":3}]');
  }
};

const _14 = /*#__PURE__*/_mergeNamespaces({
	__proto__: null,
	ids: ids,
	modules: modules,
	'default': _14$1
}, [_14$1]);

export { _14 as _ };
//# sourceMappingURL=14.mjs.map
