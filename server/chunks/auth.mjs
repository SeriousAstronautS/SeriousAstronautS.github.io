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

var auth$1 = {};

var ids = auth$1.ids = [5];
var modules = auth$1.modules = {
  70: function(module, __webpack_exports__, __webpack_require__) {
    __webpack_require__.r(__webpack_exports__);
    var render = function render2() {
      var _vm = this, _c = _vm._self._c;
      return _c("div", [_vm._ssrNode('<div class="mb-8"><h1 class="font-semibold text-3xl">\u0410\u0432\u0442\u043E\u0440\u0438\u0437\u0430\u0446\u0438\u044F</h1> <p class="text-base mt-2">\n            \u0412\u043E\u0439\u0434\u0438\u0442\u0435 \u0432 \u0441\u0432\u043E\u044E \u0443\u0447\u0435\u0442\u043D\u0443\u044E \u0437\u0430\u043F\u0438\u0441\u044C, \u0447\u0442\u043E\u0431\u044B \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u044C\u0441\u044F \u0441\u0435\u0440\u0432\u0438\u0441\u0430\u043C\u0438 \u0422\u0440\u043E\u0439\u043A\u0438!\n        </p></div> <div class="rounded-xl bg-gray-50 dark:bg-gray-800 shadow-sm shadow-gray-200/50 dark:shadow-black/50 overflow-auto p-6"><form class="space-y-2"><div><label>Username</label> <input type="text"' + _vm._ssrAttr("value", _vm.login.username) + ' class="inpt bg-gray-800 text-gray-50"></div> <div><label>Password</label> <input type="text"' + _vm._ssrAttr("value", _vm.login.password) + ' class="inpt bg-gray-800 text-gray-50"></div> <div><button type="submit" class="px-4 py-2 rounded border">Submit</button></div></form></div>')]);
    };
    var staticRenderFns = [];
    var authvue_type_script_lang_ts_ = {
      data() {
        return {
          login: {
            username: "",
            password: ""
          }
        };
      },
      methods: {
        async userLogin() {
          this.$axios.post("auth/login", {
            username: this.login.username,
            password: this.login.password
          }).then(function(response) {
            console.log(response);
          }).catch(function(error) {
            console.log(error);
          });
        }
      }
    };
    var pages_authvue_type_script_lang_ts_ = authvue_type_script_lang_ts_;
    var componentNormalizer = __webpack_require__(2);
    function injectStyles(context) {
    }
    var component = Object(componentNormalizer["a"])(
      pages_authvue_type_script_lang_ts_,
      render,
      staticRenderFns,
      false,
      injectStyles,
      null,
      "1154f91f"
    );
    __webpack_exports__["default"] = component.exports;
  }
};

const auth = /*#__PURE__*/_mergeNamespaces({
  __proto__: null,
  ids: ids,
  modules: modules,
  'default': auth$1
}, [auth$1]);

export { auth as a };
//# sourceMappingURL=auth.mjs.map
