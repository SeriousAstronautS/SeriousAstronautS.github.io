import { eventHandler, useQuery } from 'h3';
import { joinURL } from 'ufo';
import { u as useRuntimeConfig } from './node-server.mjs';
import * as stream from 'stream';
import require$$1 from 'unenv/runtime/mock/proxy';
import * as path from 'path';
import * as vm from 'vm';
import * as module from 'module';
import * as fs$1 from 'fs';

const IS_JS_RE = /\.[cm]?js(\?[^.]+)?$/;
const IS_MODULE_RE = /\.mjs(\?[^.]+)?$/;
const HAS_EXT_RE = /[^./]+\.[^./]+$/;
const IS_CSS_RE = /\.(css|postcss|sass|scss|less|stylus|styl)(\?[^.]+)?$/;
function isJS(file) {
  return IS_JS_RE.test(file) || !HAS_EXT_RE.test(file);
}
function isModule(file) {
  return IS_MODULE_RE.test(file) || !HAS_EXT_RE.test(file);
}
function isCSS(file) {
  return IS_CSS_RE.test(file);
}
function getExtension(file) {
  const withoutQuery = file.replace(/\?.*/, "");
  return withoutQuery.split(".").pop() || "";
}
function ensureTrailingSlash(path) {
  if (path === "") {
    return path;
  }
  return path.replace(/([^/])$/, "$1/");
}
function getPreloadType(ext) {
  if (ext === "js" || ext === "cjs" || ext === "mjs") {
    return "script";
  } else if (ext === "css") {
    return "style";
  } else if (/jpe?g|png|svg|gif|webp|ico/.test(ext)) {
    return "image";
  } else if (/woff2?|ttf|otf|eot/.test(ext)) {
    return "font";
  } else {
    return void 0;
  }
}

function createRendererContext({ clientManifest, publicPath, basedir, shouldPrefetch, shouldPreload }) {
  const ctx = {
    shouldPrefetch: shouldPrefetch || (() => true),
    shouldPreload: shouldPreload || ((_file, asType) => ["module", "script", "style"].includes(asType)),
    publicPath: ensureTrailingSlash(publicPath || "/"),
    basedir,
    clientManifest: void 0,
    updateManifest,
    _dependencies: void 0,
    _dependencySets: void 0,
    _entrypoints: void 0,
    _dynamicEntrypoints: void 0
  };
  function updateManifest(clientManifest2) {
    const manifest = normalizeClientManifest(clientManifest2);
    const manifestEntries = Object.entries(manifest);
    ctx.clientManifest = manifest;
    ctx._dependencies = {};
    ctx._dependencySets = {};
    ctx._entrypoints = manifestEntries.filter((e) => e[1].isEntry).map(([module]) => module);
    ctx._dynamicEntrypoints = manifestEntries.filter((e) => e[1].isDynamicEntry).map(([module]) => module);
    ctx.publicPath = ensureTrailingSlash(publicPath || clientManifest2.publicPath || "/");
  }
  updateManifest(clientManifest);
  return ctx;
}
function isLegacyClientManifest(clientManifest) {
  return "all" in clientManifest && "initial" in clientManifest;
}
function getIdentifier(output) {
  return output ? `_${output}` : null;
}
function normalizeClientManifest(manifest = {}) {
  if (!isLegacyClientManifest(manifest)) {
    return manifest;
  }
  const clientManifest = {};
  for (const outfile of manifest.all) {
    if (isJS(outfile)) {
      clientManifest[getIdentifier(outfile)] = {
        file: outfile
      };
    }
  }
  const first = getIdentifier(manifest.initial.find(isJS));
  if (first) {
    if (!(first in clientManifest)) {
      throw new Error(`Invalid manifest - initial entrypoint not in \`all\`: ${manifest.initial.find(isJS)}`);
    }
    clientManifest[first].css = [];
    clientManifest[first].assets = [];
    clientManifest[first].dynamicImports = [];
  }
  for (const outfile of manifest.initial) {
    if (isJS(outfile)) {
      clientManifest[getIdentifier(outfile)].isEntry = true;
    } else if (isCSS(outfile) && first) {
      clientManifest[first].css.push(outfile);
    } else if (first) {
      clientManifest[first].assets.push(outfile);
    }
  }
  for (const outfile of manifest.async) {
    if (isJS(outfile)) {
      const identifier = getIdentifier(outfile);
      if (!(identifier in clientManifest)) {
        throw new Error(`Invalid manifest - async module not in \`all\`: ${outfile}`);
      }
      clientManifest[identifier].isDynamicEntry = true;
      clientManifest[first].dynamicImports.push(identifier);
    } else if (first) {
      const key = isCSS(outfile) ? "css" : "assets";
      const identifier = getIdentifier(outfile);
      clientManifest[identifier] = {
        file: "",
        [key]: [outfile]
      };
      clientManifest[first].dynamicImports.push(identifier);
    }
  }
  for (const [moduleId, importIndexes] of Object.entries(manifest.modules)) {
    const jsFiles = importIndexes.map((index) => manifest.all[index]).filter(isJS);
    jsFiles.forEach((file) => {
      const identifier = getIdentifier(file);
      clientManifest[identifier] = {
        ...clientManifest[identifier],
        file
      };
    });
    const mappedIndexes = importIndexes.map((index) => manifest.all[index]);
    clientManifest[moduleId] = {
      file: "",
      imports: jsFiles.map((id) => getIdentifier(id)),
      css: mappedIndexes.filter(isCSS),
      assets: mappedIndexes.filter((i) => !isJS(i) && !isCSS(i))
    };
  }
  return clientManifest;
}
function getModuleDependencies(id, rendererContext) {
  if (rendererContext._dependencies[id]) {
    return rendererContext._dependencies[id];
  }
  const dependencies = {
    scripts: {},
    styles: {},
    preload: {},
    prefetch: {}
  };
  const meta = rendererContext.clientManifest[id];
  if (!meta) {
    rendererContext._dependencies[id] = dependencies;
    return dependencies;
  }
  if (meta.file) {
    const type = isModule(meta.file) ? "module" : "script";
    dependencies.scripts[id] = { path: meta.file, type };
    dependencies.preload[id] = { path: meta.file, type };
  }
  for (const css of meta.css || []) {
    dependencies.styles[css] = { path: css };
    dependencies.preload[css] = { path: css, type: "style" };
    dependencies.prefetch[css] = { path: css };
  }
  for (const asset of meta.assets || []) {
    dependencies.preload[asset] = { path: asset, type: getPreloadType(asset), extension: getExtension(asset) };
    dependencies.prefetch[asset] = { path: asset };
  }
  for (const depId of meta.imports || []) {
    const depDeps = getModuleDependencies(depId, rendererContext);
    Object.assign(dependencies.styles, depDeps.styles);
    Object.assign(dependencies.preload, depDeps.preload);
    Object.assign(dependencies.prefetch, depDeps.prefetch);
  }
  const filteredPreload = {};
  for (const id2 in dependencies.preload) {
    const dep = dependencies.preload[id2];
    if (rendererContext.shouldPreload(dep.path, dep.type)) {
      filteredPreload[id2] = dependencies.preload[id2];
    }
  }
  dependencies.preload = filteredPreload;
  rendererContext._dependencies[id] = dependencies;
  return dependencies;
}
function getAllDependencies(ids, rendererContext) {
  const cacheKey = Array.from(ids).join(",");
  if (rendererContext._dependencySets[cacheKey]) {
    return rendererContext._dependencySets[cacheKey];
  }
  const allDeps = {
    scripts: {},
    styles: {},
    preload: {},
    prefetch: {}
  };
  for (const id of ids) {
    const deps = getModuleDependencies(id, rendererContext);
    Object.assign(allDeps.scripts, deps.scripts);
    Object.assign(allDeps.styles, deps.styles);
    Object.assign(allDeps.preload, deps.preload);
    Object.assign(allDeps.prefetch, deps.prefetch);
    for (const dynamicDepId of rendererContext.clientManifest[id]?.dynamicImports || []) {
      const dynamicDeps = getModuleDependencies(dynamicDepId, rendererContext);
      Object.assign(allDeps.prefetch, dynamicDeps.scripts);
      Object.assign(allDeps.prefetch, dynamicDeps.styles);
      Object.assign(allDeps.prefetch, dynamicDeps.preload);
      Object.assign(allDeps.prefetch, dynamicDeps.prefetch);
    }
  }
  for (const id in allDeps.prefetch) {
    if (id in allDeps.preload) {
      delete allDeps.prefetch[id];
    }
  }
  rendererContext._dependencySets[cacheKey] = allDeps;
  return allDeps;
}
function getRequestDependencies(ssrContext, rendererContext) {
  if (ssrContext._requestDependencies) {
    return ssrContext._requestDependencies;
  }
  const ids = new Set(Array.from([
    ...rendererContext._entrypoints,
    ...ssrContext.modules || ssrContext._registeredComponents || []
  ]));
  const deps = getAllDependencies(ids, rendererContext);
  ssrContext._requestDependencies = deps;
  return deps;
}
function renderStyles(ssrContext, rendererContext) {
  const { styles } = getRequestDependencies(ssrContext, rendererContext);
  return Object.values(styles).map(({ path }) => `<link rel="stylesheet" href="${rendererContext.publicPath}${path}">`).join("");
}
function renderResourceHints(ssrContext, rendererContext) {
  return renderPreloadLinks(ssrContext, rendererContext) + renderPrefetchLinks(ssrContext, rendererContext);
}
function renderPreloadLinks(ssrContext, rendererContext) {
  const { preload } = getRequestDependencies(ssrContext, rendererContext);
  return Object.values(preload).map((file) => {
    const rel = file.type === "module" ? "modulepreload" : "preload";
    const as = file.type ? file.type === "module" ? ' as="script"' : ` as="${file.type}"` : "";
    const type = file.type === "font" ? ` type="font/${file.extension}" crossorigin` : "";
    const crossorigin = file.type === "font" || file.type === "module" ? " crossorigin" : "";
    return `<link rel="${rel}" href="${rendererContext.publicPath}${file.path}"${as}${type}${crossorigin}>`;
  }).join("");
}
function renderPrefetchLinks(ssrContext, rendererContext) {
  const { prefetch } = getRequestDependencies(ssrContext, rendererContext);
  return Object.values(prefetch).map(({ path }) => {
    const rel = "prefetch" + (isCSS(path) ? " stylesheet" : "");
    const as = isJS(path) ? ' as="script"' : "";
    return `<link rel="${rel}"${as} href="${rendererContext.publicPath}${path}">`;
  }).join("");
}
function renderScripts(ssrContext, rendererContext) {
  const { scripts } = getRequestDependencies(ssrContext, rendererContext);
  return Object.values(scripts).map(({ path, type }) => `<script${type === "module" ? ' type="module"' : ""} src="${rendererContext.publicPath}${path}"${type !== "module" ? " defer" : ""} crossorigin><\/script>`).join("");
}
function createRenderer$1(createApp, renderOptions) {
  const rendererContext = createRendererContext(renderOptions);
  return {
    rendererContext,
    async renderToString(ssrContext) {
      ssrContext._registeredComponents = ssrContext._registeredComponents || /* @__PURE__ */ new Set();
      const _createApp = await Promise.resolve(createApp).then((r) => r.default || r);
      const app = await _createApp(ssrContext);
      const html = await renderOptions.renderToString(app, ssrContext);
      const wrap = (fn) => () => fn(ssrContext, rendererContext);
      return {
        html,
        renderResourceHints: wrap(renderResourceHints),
        renderStyles: wrap(renderStyles),
        renderScripts: wrap(renderScripts)
      };
    }
  };
}

const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$";
const unsafeChars = /[<>\b\f\n\r\t\0\u2028\u2029]/g;
const reserved = /^(?:do|if|in|for|int|let|new|try|var|byte|case|char|else|enum|goto|long|this|void|with|await|break|catch|class|const|final|float|short|super|throw|while|yield|delete|double|export|import|native|return|switch|throws|typeof|boolean|default|extends|finally|package|private|abstract|continue|debugger|function|volatile|interface|protected|transient|implements|instanceof|synchronized)$/;
const escaped = {
  "<": "\\u003C",
  ">": "\\u003E",
  "/": "\\u002F",
  "\\": "\\\\",
  "\b": "\\b",
  "\f": "\\f",
  "\n": "\\n",
  "\r": "\\r",
  "	": "\\t",
  "\0": "\\0",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029"
};
const objectProtoOwnPropertyNames = Object.getOwnPropertyNames(Object.prototype).sort().join("\0");
function devalue(value) {
  const counts = new Map();
  let logNum = 0;
  function log(message) {
    if (logNum < 100) {
      console.warn(message);
      logNum += 1;
    }
  }
  function walk(thing) {
    if (typeof thing === "function") {
      log(`Cannot stringify a function ${thing.name}`);
      return;
    }
    if (counts.has(thing)) {
      counts.set(thing, counts.get(thing) + 1);
      return;
    }
    counts.set(thing, 1);
    if (!isPrimitive(thing)) {
      const type = getType(thing);
      switch (type) {
        case "Number":
        case "String":
        case "Boolean":
        case "Date":
        case "RegExp":
          return;
        case "Array":
          thing.forEach(walk);
          break;
        case "Set":
        case "Map":
          Array.from(thing).forEach(walk);
          break;
        default:
          const proto = Object.getPrototypeOf(thing);
          if (proto !== Object.prototype && proto !== null && Object.getOwnPropertyNames(proto).sort().join("\0") !== objectProtoOwnPropertyNames) {
            if (typeof thing.toJSON !== "function") {
              log(`Cannot stringify arbitrary non-POJOs ${thing.constructor.name}`);
            }
          } else if (Object.getOwnPropertySymbols(thing).length > 0) {
            log(`Cannot stringify POJOs with symbolic keys ${Object.getOwnPropertySymbols(thing).map((symbol) => symbol.toString())}`);
          } else {
            Object.keys(thing).forEach((key) => walk(thing[key]));
          }
      }
    }
  }
  walk(value);
  const names = new Map();
  Array.from(counts).filter((entry) => entry[1] > 1).sort((a, b) => b[1] - a[1]).forEach((entry, i) => {
    names.set(entry[0], getName(i));
  });
  function stringify(thing) {
    if (names.has(thing)) {
      return names.get(thing);
    }
    if (isPrimitive(thing)) {
      return stringifyPrimitive(thing);
    }
    const type = getType(thing);
    switch (type) {
      case "Number":
      case "String":
      case "Boolean":
        return `Object(${stringify(thing.valueOf())})`;
      case "RegExp":
        return thing.toString();
      case "Date":
        return `new Date(${thing.getTime()})`;
      case "Array":
        const members = thing.map((v, i) => i in thing ? stringify(v) : "");
        const tail = thing.length === 0 || thing.length - 1 in thing ? "" : ",";
        return `[${members.join(",")}${tail}]`;
      case "Set":
      case "Map":
        return `new ${type}([${Array.from(thing).map(stringify).join(",")}])`;
      default:
        if (thing.toJSON) {
          let json = thing.toJSON();
          if (getType(json) === "String") {
            try {
              json = JSON.parse(json);
            } catch (e) {
            }
          }
          return stringify(json);
        }
        if (Object.getPrototypeOf(thing) === null) {
          if (Object.keys(thing).length === 0) {
            return "Object.create(null)";
          }
          return `Object.create(null,{${Object.keys(thing).map((key) => `${safeKey(key)}:{writable:true,enumerable:true,value:${stringify(thing[key])}}`).join(",")}})`;
        }
        return `{${Object.keys(thing).map((key) => `${safeKey(key)}:${stringify(thing[key])}`).join(",")}}`;
    }
  }
  const str = stringify(value);
  if (names.size) {
    const params = [];
    const statements = [];
    const values = [];
    names.forEach((name, thing) => {
      params.push(name);
      if (isPrimitive(thing)) {
        values.push(stringifyPrimitive(thing));
        return;
      }
      const type = getType(thing);
      switch (type) {
        case "Number":
        case "String":
        case "Boolean":
          values.push(`Object(${stringify(thing.valueOf())})`);
          break;
        case "RegExp":
          values.push(thing.toString());
          break;
        case "Date":
          values.push(`new Date(${thing.getTime()})`);
          break;
        case "Array":
          values.push(`Array(${thing.length})`);
          thing.forEach((v, i) => {
            statements.push(`${name}[${i}]=${stringify(v)}`);
          });
          break;
        case "Set":
          values.push("new Set");
          statements.push(`${name}.${Array.from(thing).map((v) => `add(${stringify(v)})`).join(".")}`);
          break;
        case "Map":
          values.push("new Map");
          statements.push(`${name}.${Array.from(thing).map(([k, v]) => `set(${stringify(k)}, ${stringify(v)})`).join(".")}`);
          break;
        default:
          values.push(Object.getPrototypeOf(thing) === null ? "Object.create(null)" : "{}");
          Object.keys(thing).forEach((key) => {
            statements.push(`${name}${safeProp(key)}=${stringify(thing[key])}`);
          });
      }
    });
    statements.push(`return ${str}`);
    return `(function(${params.join(",")}){${statements.join(";")}}(${values.join(",")}))`;
  } else {
    return str;
  }
}
function getName(num) {
  let name = "";
  do {
    name = chars[num % chars.length] + name;
    num = ~~(num / chars.length) - 1;
  } while (num >= 0);
  return reserved.test(name) ? `${name}0` : name;
}
function isPrimitive(thing) {
  return Object(thing) !== thing;
}
function stringifyPrimitive(thing) {
  if (typeof thing === "string") {
    return stringifyString(thing);
  }
  if (thing === void 0) {
    return "void 0";
  }
  if (thing === 0 && 1 / thing < 0) {
    return "-0";
  }
  const str = String(thing);
  if (typeof thing === "number") {
    return str.replace(/^(-)?0\./, "$1.");
  }
  return str;
}
function getType(thing) {
  return Object.prototype.toString.call(thing).slice(8, -1);
}
function escapeUnsafeChar(c) {
  return escaped[c] || c;
}
function escapeUnsafeChars(str) {
  return str.replace(unsafeChars, escapeUnsafeChar);
}
function safeKey(key) {
  return /^[_$a-zA-Z][_$a-zA-Z0-9]*$/.test(key) ? key : escapeUnsafeChars(JSON.stringify(key));
}
function safeProp(key) {
  return /^[_$a-zA-Z][_$a-zA-Z0-9]*$/.test(key) ? `.${key}` : `[${escapeUnsafeChars(JSON.stringify(key))}]`;
}
function stringifyString(str) {
  let result = '"';
  for (let i = 0; i < str.length; i += 1) {
    const char = str.charAt(i);
    const code = char.charCodeAt(0);
    if (char === '"') {
      result += '\\"';
    } else if (char in escaped) {
      result += escaped[char];
    } else if (code >= 55296 && code <= 57343) {
      const next = str.charCodeAt(i + 1);
      if (code <= 56319 && (next >= 56320 && next <= 57343)) {
        result += char + str[++i];
      } else {
        result += `\\u${code.toString(16).toUpperCase()}`;
      }
    } else {
      result += char;
    }
  }
  result += '"';
  return result;
}

function buildAssetsURL(...path) {
  return joinURL(publicAssetsURL(), useRuntimeConfig().app.buildAssetsDir, ...path);
}
function publicAssetsURL(...path) {
  const publicBase = useRuntimeConfig().app.cdnURL || useRuntimeConfig().app.baseURL;
  return path.length ? joinURL(publicBase, ...path) : publicBase;
}

const htmlTemplate = (params) => `<!DOCTYPE html>
<html ${params.HTML_ATTRS}>
  <head ${params.HEAD_ATTRS}>
    ${params.HEAD}
  </head>
  <body ${params.BODY_ATTRS}>
    ${params.APP}
  </body>
</html>
`;

var commonjsGlobal = typeof globalThis !== 'undefined' ? globalThis : "undefined" !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {};

function getDefaultExportFromCjs (x) {
	return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, 'default') ? x['default'] : x;
}

function getDefaultExportFromNamespaceIfNotNamed (n) {
	return n && Object.prototype.hasOwnProperty.call(n, 'default') && Object.keys(n).length === 1 ? n['default'] : n;
}

function commonjsRequire(path) {
	throw new Error('Could not dynamically require "' + path + '". Please configure the dynamicRequireTargets or/and ignoreDynamicRequires option of @rollup/plugin-commonjs appropriately for this require call to work.');
}

var build_prod = {};

const require$$0 = /*@__PURE__*/getDefaultExportFromNamespaceIfNotNamed(stream);

const require$$3 = /*@__PURE__*/getDefaultExportFromNamespaceIfNotNamed(path);

const require$$5 = /*@__PURE__*/getDefaultExportFromNamespaceIfNotNamed(vm);

const require$$7 = /*@__PURE__*/getDefaultExportFromNamespaceIfNotNamed(module);

const require$$9 = /*@__PURE__*/getDefaultExportFromNamespaceIfNotNamed(fs$1);

var createRenderer;
Object.defineProperty(build_prod,"__esModule",{value:!0});var e=require$$0;function t(e){return e&&"object"==typeof e&&"default"in e?e:{default:e}}var n=t(require$$1);const r=Object.freeze({}),s=Array.isArray;function o(e){return null==e}function i(e){return null!=e}function c(e){return !0===e}function a(e){return "string"==typeof e||"number"==typeof e||"symbol"==typeof e||"boolean"==typeof e}function l(e){return "function"==typeof e}function u(e){return null!==e&&"object"==typeof e}const f=Object.prototype.toString;function p(e){return "[object Object]"===f.call(e)}function d(e){return null==e?"":Array.isArray(e)||p(e)&&e.toString===f?JSON.stringify(e,null,2):String(e)}function h(e){const t=parseFloat(e);return isNaN(t)?e:t}function m(e,t){const n=Object.create(null),r=e.split(",");for(let e=0;e<r.length;e++)n[r[e]]=!0;return t?e=>n[e.toLowerCase()]:e=>n[e]}const g=m("slot,component",!0),y=m("key,ref,slot,slot-scope,is");const $=Object.prototype.hasOwnProperty;function v(e,t){return $.call(e,t)}function b(e){const t=Object.create(null);return function(n){return t[n]||(t[n]=e(n))}}const _=/-(\w)/g,x=b((e=>e.replace(_,((e,t)=>t?t.toUpperCase():"")))),w=b((e=>e.charAt(0).toUpperCase()+e.slice(1))),S=/\B([A-Z])/g,k=b((e=>e.replace(S,"-$1").toLowerCase()));function O(e,t){for(const n in t)e[n]=t[n];return e}function C(e){const t={};for(let n=0;n<e.length;n++)e[n]&&O(t,e[n]);return t}function T(e,t,n){}const A=(e,t,n)=>!1,j=e=>e;function F(e,t){if(e===t)return !0;const n=u(e),r=u(t);if(!n||!r)return !n&&!r&&String(e)===String(t);try{const n=Array.isArray(e),r=Array.isArray(t);if(n&&r)return e.length===t.length&&e.every(((e,n)=>F(e,t[n])));if(e instanceof Date&&t instanceof Date)return e.getTime()===t.getTime();if(n||r)return !1;{const n=Object.keys(e),r=Object.keys(t);return n.length===r.length&&n.every((n=>F(e[n],t[n])))}}catch(e){return !1}}function P(e,t){for(let n=0;n<e.length;n++)if(F(e[n],t))return n;return -1}function N(e,t){return e===t?0===e&&1/e!=1/t:e==e||t==t}const E=m("accept,accept-charset,accesskey,action,align,alt,async,autocomplete,autofocus,autoplay,autosave,bgcolor,border,buffered,challenge,charset,checked,cite,class,code,codebase,color,cols,colspan,content,contenteditable,contextmenu,controls,coords,data,datetime,default,defer,dir,dirname,disabled,download,draggable,dropzone,enctype,for,form,formaction,headers,height,hidden,high,href,hreflang,http-equiv,icon,id,ismap,itemprop,keytype,kind,label,lang,language,list,loop,low,manifest,max,maxlength,media,method,GET,POST,min,multiple,email,file,muted,name,novalidate,open,optimum,pattern,ping,placeholder,poster,preload,radiogroup,readonly,rel,required,reversed,rows,rowspan,sandbox,scope,scoped,seamless,selected,shape,size,type,text,password,sizes,span,spellcheck,src,srcdoc,srclang,srcset,start,step,style,summary,tabindex,target,title,usemap,value,width,wrap"),I=/[>/="'\u0009\u000a\u000c\u0020]/,M=e=>I.test(e),R=e=>E(e)||0===e.indexOf("data-")||0===e.indexOf("aria-"),D={acceptCharset:"accept-charset",className:"class",htmlFor:"for",httpEquiv:"http-equiv"},L={"<":"&lt;",">":"&gt;",'"':"&quot;","&":"&amp;"};function z(e){return e.replace(/[<>"&]/g,B)}function B(e){return L[e]||e}const U={"animation-iteration-count":!0,"border-image-outset":!0,"border-image-slice":!0,"border-image-width":!0,"box-flex":!0,"box-flex-group":!0,"box-ordinal-group":!0,"column-count":!0,columns:!0,flex:!0,"flex-grow":!0,"flex-positive":!0,"flex-shrink":!0,"flex-negative":!0,"flex-order":!0,"grid-row":!0,"grid-row-end":!0,"grid-row-span":!0,"grid-row-start":!0,"grid-column":!0,"grid-column-end":!0,"grid-column-span":!0,"grid-column-start":!0,"font-weight":!0,"line-clamp":!0,"line-height":!0,opacity:!0,order:!0,orphans:!0,"tab-size":!0,widows:!0,"z-index":!0,zoom:!0,"fill-opacity":!0,"flood-opacity":!0,"stop-opacity":!0,"stroke-dasharray":!0,"stroke-dashoffset":!0,"stroke-miterlimit":!0,"stroke-opacity":!0,"stroke-width":!0},q=e=>/\.js(\?[^.]+)?$/.test(e);function J(){let e,t;return {promise:new Promise(((n,r)=>{e=n,t=r;})),cb:(n,r)=>{if(n)return t(n);e(r||"");}}}const K=m("input,textarea,option,select,progress"),H=m("contenteditable,draggable,spellcheck"),V=m("events,caret,typing,plaintext-only"),Z=m("allowfullscreen,async,autofocus,autoplay,checked,compact,controls,declare,default,defaultchecked,defaultmuted,defaultselected,defer,disabled,enabled,formnovalidate,hidden,indeterminate,inert,ismap,itemscope,loop,multiple,muted,nohref,noresize,noshade,novalidate,nowrap,open,pauseonexit,readonly,required,reversed,scoped,seamless,selected,sortable,truespeed,typemustmatch,visible"),W=e=>null==e||!1===e;function G(e,t){if(Z(e)){if(!W(t))return ` ${e}="${e}"`}else {if(H(e))return ` ${e}="${z(((e,t)=>W(t)||"false"===t?"false":"contenteditable"===e&&V(t)?t:"true")(e,t))}"`;if(!W(t))return ` ${e}="${z(String(t))}"`}return ""}class Q{constructor(e,t,n,r,s,o,i,c){this.tag=e,this.data=t,this.children=n,this.text=r,this.elm=s,this.ns=void 0,this.context=o,this.fnContext=void 0,this.fnOptions=void 0,this.fnScopeId=void 0,this.key=t&&t.key,this.componentOptions=i,this.componentInstance=void 0,this.parent=void 0,this.raw=!1,this.isStatic=!1,this.isRootInsert=!0,this.isComment=!1,this.isCloned=!1,this.isOnce=!1,this.asyncFactory=c,this.asyncMeta=void 0,this.isAsyncPlaceholder=!1;}get child(){return this.componentInstance}}const X=(e="")=>{const t=new Q;return t.text=e,t.isComment=!0,t};function Y(e){return new Q(void 0,void 0,void 0,String(e))}function ee(e,t,n){const r=new Q(void 0,void 0,void 0,t);r.raw=n,e.children=[r];}function te(e,t,n,r){Object.defineProperty(e,t,{value:n,enumerable:!!r,writable:!0,configurable:!0});}const ne="__proto__"in{};const ie={}.watch;let ce;const le=()=>(void 0===ce&&(ce="undefined"!=typeof commonjsGlobal&&(commonjsGlobal.process&&"server"===commonjsGlobal.process.env.VUE_ENV)),ce);function ue(e){return "function"==typeof e&&/native code/.test(e.toString())}const fe="undefined"!=typeof Symbol&&ue(Symbol)&&"undefined"!=typeof Reflect&&ue(Reflect.ownKeys);let pe;pe="undefined"!=typeof Set&&ue(Set)?Set:class{constructor(){this.set=Object.create(null);}has(e){return !0===this.set[e]}add(e){this.set[e]=!0;}clear(){this.set=Object.create(null);}};const de=["beforeCreate","created","beforeMount","mounted","beforeUpdate","updated","beforeDestroy","destroyed","activated","deactivated","errorCaptured","serverPrefetch","renderTracked","renderTriggered"];var he={optionMergeStrategies:Object.create(null),silent:!1,productionTip:!1,devtools:!1,performance:!1,errorHandler:null,warnHandler:null,ignoredElements:[],keyCodes:Object.create(null),isReservedTag:A,isReservedAttr:A,isUnknownElement:A,getTagNamespace:T,parsePlatformTagName:j,mustUseProp:A,async:!0,_lifecycleHooks:de};let me=null;function ge(e=null){e||me&&me._scope.off(),me=e,e&&e._scope.on();}let ye=0;class $e{constructor(){this.id=ye++,this.subs=[];}addSub(e){this.subs.push(e);}removeSub(e){!function(e,t){if(e.length){const n=e.indexOf(t);if(n>-1)e.splice(n,1);}}(this.subs,e);}depend(e){$e.target&&$e.target.addDep(this);}notify(e){const t=this.subs.slice();for(let e=0,n=t.length;e<n;e++)t[e].update();}}$e.target=null;const ve=[];function be(e){ve.push(e),$e.target=e;}function _e(){ve.pop(),$e.target=ve[ve.length-1];}const xe=Array.prototype,we=Object.create(xe);["push","pop","shift","unshift","splice","sort","reverse"].forEach((function(e){const t=xe[e];te(we,e,(function(...n){const r=t.apply(this,n),s=this.__ob__;let o;switch(e){case"push":case"unshift":o=n;break;case"splice":o=n.slice(2);}return o&&s.observeArray(o),s.dep.notify(),r}));}));const Se=Object.getOwnPropertyNames(we),ke={};let Oe=!0;function Ce(e){Oe=e;}const Te={notify:T,depend:T,addSub:T,removeSub:T};class Ae{constructor(e,t=!1,n=!1){if(this.value=e,this.shallow=t,this.mock=n,this.dep=n?Te:new $e,this.vmCount=0,te(e,"__ob__",this),s(e)){if(!n)if(ne)e.__proto__=we;else for(let t=0,n=Se.length;t<n;t++){const n=Se[t];te(e,n,we[n]);}t||this.observeArray(e);}else {const r=Object.keys(e);for(let s=0;s<r.length;s++){Fe(e,r[s],ke,void 0,t,n);}}}observeArray(e){for(let t=0,n=e.length;t<n;t++)je(e[t],!1,this.mock);}}function je(e,t,n){if(!u(e)||Ee(e)||e instanceof Q)return;let r;return v(e,"__ob__")&&e.__ob__ instanceof Ae?r=e.__ob__:!Oe||!n&&le()||!s(e)&&!p(e)||!Object.isExtensible(e)||e.__v_skip||(r=new Ae(e,t,n)),r}function Fe(e,t,n,r,o,i){const c=new $e,a=Object.getOwnPropertyDescriptor(e,t);if(a&&!1===a.configurable)return;const l=a&&a.get,u=a&&a.set;l&&!u||n!==ke&&2!==arguments.length||(n=e[t]);let f=!o&&je(n,!1,i);return Object.defineProperty(e,t,{enumerable:!0,configurable:!0,get:function(){const t=l?l.call(e):n;return $e.target&&(c.depend(),f&&(f.dep.depend(),s(t)&&Ne(t))),Ee(t)&&!o?t.value:t},set:function(t){const r=l?l.call(e):n;if(N(r,t)){if(u)u.call(e,t);else {if(l)return;if(!o&&Ee(r)&&!Ee(t))return void(r.value=t);n=t;}f=!o&&je(t,!1,i),c.notify();}}}),c}function Pe(e,t,n){if((r=e)&&r.__v_isReadonly)return;var r;const o=e.__ob__;return s(e)&&function(e){const t=parseFloat(String(e));return t>=0&&Math.floor(t)===t&&isFinite(e)}(t)?(e.length=Math.max(e.length,t),e.splice(t,1,n),o&&!o.shallow&&o.mock&&je(n,!1,!0),n):t in e&&!(t in Object.prototype)?(e[t]=n,n):e._isVue||o&&o.vmCount?n:o?(Fe(o.value,t,n,void 0,o.shallow,o.mock),o.dep.notify(),n):(e[t]=n,n)}function Ne(e){for(let t,n=0,r=e.length;n<r;n++)t=e[n],t&&t.__ob__&&t.__ob__.dep.depend(),s(t)&&Ne(t);}function Ee(e){return !(!e||!0!==e.__v_isRef)}const Ie=b((e=>{const t="&"===e.charAt(0),n="~"===(e=t?e.slice(1):e).charAt(0),r="!"===(e=n?e.slice(1):e).charAt(0);return {name:e=r?e.slice(1):e,once:n,capture:r,passive:t}}));function Me(e,t){function n(){const e=n.fns;if(!s(e))return wt(e,null,arguments,t,"v-on handler");{const n=e.slice();for(let e=0;e<n.length;e++)wt(n[e],null,arguments,t,"v-on handler");}}return n.fns=e,n}function Re(e,t,n,r,s){if(i(t)){if(v(t,n))return e[n]=t[n],s||delete t[n],!0;if(v(t,r))return e[n]=t[r],s||delete t[r],!0}return !1}function De(e){for(let t=0;t<e.length;t++)if(s(e[t]))return Array.prototype.concat.apply([],e);return e}function Le(e){return a(e)?[Y(e)]:s(e)?Be(e):void 0}function ze(e){return i(e)&&i(e.text)&&!1===e.isComment}function Be(e,t){const n=[];let r,l,u,f;for(r=0;r<e.length;r++)l=e[r],o(l)||"boolean"==typeof l||(u=n.length-1,f=n[u],s(l)?l.length>0&&(l=Be(l,`${t||""}_${r}`),ze(l[0])&&ze(f)&&(n[u]=Y(f.text+l[0].text),l.shift()),n.push.apply(n,l)):a(l)?ze(f)?n[u]=Y(f.text+l):""!==l&&n.push(Y(l)):ze(l)&&ze(f)?n[u]=Y(f.text+l.text):(c(e._isVList)&&i(l.tag)&&o(l.key)&&i(t)&&(l.key=`__vlist${t}_${r}__`),n.push(l)));return n}function Ue(e,t,n,r,o,f){return (s(n)||a(n))&&(o=r,r=n,n=void 0),c(f)&&(o=2),function(e,t,n,r,o){if(i(n)&&i(n.__ob__))return X();i(n)&&i(n.is)&&(t=n.is);if(!t)return X();s(r)&&l(r[0])&&((n=n||{}).scopedSlots={default:r[0]},r.length=0);2===o?r=Le(r):1===o&&(r=De(r));let c,a;if("string"==typeof t){let s;a=e.$vnode&&e.$vnode.ns||he.getTagNamespace(t),c=n&&n.pre||!i(s=Kt(e.$options,"components",t))?new Q(t,n,r,void 0,void 0,e):It(s,n,e,r,t);}else c=It(t,n,e,r);return s(c)?c:i(c)?(i(a)&&qe(c,a),i(n)&&function(e){u(e.style)&&Ct(e.style);u(e.class)&&Ct(e.class);}(n),c):X()}(e,t,n,r,o)}function qe(e,t,n){if(e.ns=t,"foreignObject"===e.tag&&(t=void 0,n=!0),i(e.children))for(let r=0,s=e.children.length;r<s;r++){const s=e.children[r];i(s.tag)&&(o(s.ns)||c(n)&&"svg"!==s.tag)&&qe(s,t,n);}}function Je(e,t){let n,r,o,c,a=null;if(s(e)||"string"==typeof e)for(a=new Array(e.length),n=0,r=e.length;n<r;n++)a[n]=t(e[n],n);else if("number"==typeof e)for(a=new Array(e),n=0;n<e;n++)a[n]=t(n+1,n);else if(u(e))if(fe&&e[Symbol.iterator]){a=[];const n=e[Symbol.iterator]();let r=n.next();for(;!r.done;)a.push(t(r.value,a.length)),r=n.next();}else for(o=Object.keys(e),a=new Array(o.length),n=0,r=o.length;n<r;n++)c=o[n],a[n]=t(e[c],c,n);return i(a)||(a=[]),a._isVList=!0,a}function Ke(e,t,n,r){const s=this.$scopedSlots[e];let o;s?(n=n||{},r&&(n=O(O({},r),n)),o=s(n)||(l(t)?t():t)):o=this.$slots[e]||(l(t)?t():t);const i=n&&n.slot;return i?this.$createElement("template",{slot:i},o):o}function He(e){return Kt(this.$options,"filters",e)||j}function Ve(e,t){return s(e)?-1===e.indexOf(t):e!==t}function Ze(e,t,n,r,s){const o=he.keyCodes[t]||n;return s&&r&&!he.keyCodes[t]?Ve(s,r):o?Ve(o,e):r?k(r)!==t:void 0===e}function We(e,t,n,r,o){if(n)if(u(n)){let i;s(n)&&(n=C(n));for(const s in n){if("class"===s||"style"===s||y(s))i=e;else {const n=e.attrs&&e.attrs.type;i=r||he.mustUseProp(t,n,s)?e.domProps||(e.domProps={}):e.attrs||(e.attrs={});}const c=x(s),a=k(s);if(!(c in i)&&!(a in i)&&(i[s]=n[s],o)){(e.on||(e.on={}))[`update:${s}`]=function(e){n[s]=e;};}}}return e}function Ge(e,t){const n=this._staticTrees||(this._staticTrees=[]);let r=n[e];return r&&!t||(r=n[e]=this.$options.staticRenderFns[e].call(this._renderProxy,this._c,this),Xe(r,`__static__${e}`,!1)),r}function Qe(e,t,n){return Xe(e,`__once__${t}${n?`_${n}`:""}`,!0),e}function Xe(e,t,n){if(s(e))for(let r=0;r<e.length;r++)e[r]&&"string"!=typeof e[r]&&Ye(e[r],`${t}_${r}`,n);else Ye(e,t,n);}function Ye(e,t,n){e.isStatic=!0,e.key=t,e.isOnce=n;}function et(e,t){if(t)if(p(t)){const n=e.on=e.on?O({},e.on):{};for(const e in t){const r=n[e],s=t[e];n[e]=r?[].concat(r,s):s;}}return e}function tt(e,t,n,r){t=t||{$stable:!n};for(let r=0;r<e.length;r++){const o=e[r];s(o)?tt(o,t,n):o&&(o.proxy&&(o.fn.proxy=!0),t[o.key]=o.fn);}return r&&(t.$key=r),t}function nt(e,t){for(let n=0;n<t.length;n+=2){const r=t[n];"string"==typeof r&&r&&(e[t[n]]=t[n+1]);}return e}function rt(e,t){return "string"==typeof e?t+e:e}function st(e,t){if(!e||!e.length)return {};const n={};for(let r=0,s=e.length;r<s;r++){const s=e[r],o=s.data;if(o&&o.attrs&&o.attrs.slot&&delete o.attrs.slot,s.context!==t&&s.fnContext!==t||!o||null==o.slot)(n.default||(n.default=[])).push(s);else {const e=o.slot,t=n[e]||(n[e]=[]);"template"===s.tag?t.push.apply(t,s.children||[]):t.push(s);}}for(const e in n)n[e].every(ot)&&delete n[e];return n}function ot(e){return e.isComment&&!e.asyncFactory||" "===e.text}function it(e){return e.isComment&&e.asyncFactory}function ct(e,t,n,s){let o;const i=Object.keys(n).length>0,c=t?!!t.$stable:!i,a=t&&t.$key;if(t){if(t._normalized)return t._normalized;if(c&&s&&s!==r&&a===s.$key&&!i&&!s.$hasNormal)return s;o={};for(const r in t)t[r]&&"$"!==r[0]&&(o[r]=at(e,n,r,t[r]));}else o={};for(const e in n)e in o||(o[e]=lt(n,e));return t&&Object.isExtensible(t)&&(t._normalized=o),te(o,"$stable",c),te(o,"$key",a),te(o,"$hasNormal",i),o}function at(e,t,n,r){const o=function(){const t=me;ge(e);let n=arguments.length?r.apply(null,arguments):r({});n=n&&"object"==typeof n&&!s(n)?[n]:Le(n);const o=n&&n[0];return ge(t),n&&(!o||1===n.length&&o.isComment&&!it(o))?void 0:n};return r.proxy&&Object.defineProperty(t,n,{get:o,enumerable:!0,configurable:!0}),o}function lt(e,t){return ()=>e[t]}function ut(e,t,n,r,s){let o=!1;for(const i in t)i in e?t[i]!==n[i]&&(o=!0):(o=!0,ft(e,i,r,s));for(const n in e)n in t||(o=!0,delete e[n]);return o}function ft(e,t,n,r){Object.defineProperty(e,t,{enumerable:!0,configurable:!0,get:()=>n[r][t]});}let pt;function dt(e,t){pt.$on(e,t);}function ht(e,t){pt.$off(e,t);}function mt(e,t){const n=pt;return function r(){const s=t.apply(null,arguments);null!==s&&n.$off(e,r);}}function gt(e,t,n){pt=e,function(e,t,n,r,s,i){let a,l,u,f;for(a in e)l=e[a],u=t[a],f=Ie(a),o(l)||(o(u)?(o(l.fns)&&(l=e[a]=Me(l,i)),c(f.once)&&(l=e[a]=s(f.name,l,f.capture)),n(f.name,l,f.capture,f.passive,f.params)):l!==u&&(u.fns=l,e[a]=u));for(a in t)o(e[a])&&(f=Ie(a),r(f.name,t[a],f.capture));}(t,n||{},dt,ht,mt,e),pt=void 0;}function yt(e){for(;e&&(e=e.$parent);)if(e._inactive)return !0;return !1}function $t(e,t){if(t){if(e._directInactive=!1,yt(e))return}else if(e._directInactive)return;if(e._inactive||null===e._inactive){e._inactive=!1;for(let t=0;t<e.$children.length;t++)$t(e.$children[t]);bt(e,"activated");}}function vt(e,t){if(!(t&&(e._directInactive=!0,yt(e))||e._inactive)){e._inactive=!0;for(let t=0;t<e.$children.length;t++)vt(e.$children[t]);bt(e,"deactivated");}}function bt(e,t,n,r=!0){be();const s=me;r&&ge(e);const o=e.$options[t],i=`${t} hook`;if(o)for(let t=0,r=o.length;t<r;t++)wt(o[t],e,n||null,e,i);e._hasHookEvent&&e.$emit("hook:"+t),r&&ge(s),_e();}function xt(e,t,n){be();try{if(t){let r=t;for(;r=r.$parent;){const s=r.$options.errorCaptured;if(s)for(let o=0;o<s.length;o++)try{if(!1===s[o].call(r,e,t,n))return}catch(e){St(e,r,"errorCaptured hook");}}}St(e,t,n);}finally{_e();}}function wt(e,t,n,r,s){let o;try{o=n?e.apply(t,n):e.call(t),o&&!o._isVue&&(i(c=o)&&"function"==typeof c.then&&"function"==typeof c.catch)&&!o._handled&&(o.catch((e=>xt(e,r,s+" (Promise/async)"))),o._handled=!0);}catch(e){xt(e,r,s);}var c;return o}function St(e,t,n){!function(e,t,n){throw e;}(e);}const kt=[];if("undefined"!=typeof Promise&&ue(Promise))Promise.resolve();else if("undefined"==typeof MutationObserver||!ue(MutationObserver)&&"[object MutationObserverConstructor]"!==MutationObserver.toString())"undefined"!=typeof setImmediate&&ue(setImmediate);else {let e=1;const t=new MutationObserver((function(){const e=kt.slice(0);kt.length=0;for(let t=0;t<e.length;t++)e[t]();})),n=document.createTextNode(String(e));t.observe(n,{characterData:!0});}const Ot=new pe;function Ct(e){return Tt(e,Ot),Ot.clear(),e}function Tt(e,t){let n,r;const o=s(e);if(!(!o&&!u(e)||Object.isFrozen(e)||e instanceof Q)){if(e.__ob__){const n=e.__ob__.dep.id;if(t.has(n))return;t.add(n);}if(o)for(n=e.length;n--;)Tt(e[n],t);else if(Ee(e))Tt(e.value,t);else for(r=Object.keys(e),n=r.length;n--;)Tt(e[r[n]],t);}}function At(e){let t=e.options;if(e.super){const n=At(e.super);if(n!==e.superOptions){e.superOptions=n;const r=function(e){let t;const n=e.options,r=e.sealedOptions;for(const e in n)n[e]!==r[e]&&(t||(t={}),t[e]=n[e]);return t}(e);r&&O(e.extendOptions,r),t=e.options=Jt(n,e.extendOptions),t.name&&(t.components[t.name]=e);}}return t}function jt(e,t,n,o,i){const a=i.options;let u;v(o,"_uid")?(u=Object.create(o),u._original=o):(u=o,o=o._original);const f=c(a._compiled),p=!f;this.data=e,this.props=t,this.children=n,this.parent=o,this.listeners=e.on||r,this.injections=function(e,t){if(e){const n=Object.create(null),r=fe?Reflect.ownKeys(e):Object.keys(e);for(let s=0;s<r.length;s++){const o=r[s];if("__ob__"===o)continue;const i=e[o].from;if(i in t._provided)n[o]=t._provided[i];else if("default"in e[o]){const r=e[o].default;n[o]=l(r)?r.call(t):r;}}return n}}(a.inject,o),this.slots=()=>(this.$slots||ct(o,e.scopedSlots,this.$slots=st(n,o)),this.$slots),Object.defineProperty(this,"scopedSlots",{enumerable:!0,get(){return ct(o,e.scopedSlots,this.slots())}}),f&&(this.$options=a,this.$slots=this.slots(),this.$scopedSlots=ct(o,e.scopedSlots,this.$slots)),a._scopeId?this._c=(e,t,n,r)=>{const i=Ue(u,e,t,n,r,p);return i&&!s(i)&&(i.fnScopeId=a._scopeId,i.fnContext=o),i}:this._c=(e,t,n,r)=>Ue(u,e,t,n,r,p);}function Ft(e,t,n,r,s){const o=function(e){const t=new Q(e.tag,e.data,e.children&&e.children.slice(),e.text,e.elm,e.context,e.componentOptions,e.asyncFactory);return t.ns=e.ns,t.isStatic=e.isStatic,t.key=e.key,t.isComment=e.isComment,t.fnContext=e.fnContext,t.fnOptions=e.fnOptions,t.fnScopeId=e.fnScopeId,t.asyncMeta=e.asyncMeta,t.isCloned=!0,t}(e);return o.fnContext=n,o.fnOptions=r,t.slot&&((o.data||(o.data={})).slot=t.slot),o}function Pt(e,t){for(const n in t)e[x(n)]=t[n];}!function(e){e._o=Qe,e._n=h,e._s=d,e._l=Je,e._t=Ke,e._q=F,e._i=P,e._m=Ge,e._f=He,e._k=Ze,e._b=We,e._v=Y,e._e=X,e._u=tt,e._g=et,e._d=nt,e._p=rt;}(jt.prototype);const Nt={init(e,t){if(e.componentInstance&&!e.componentInstance._isDestroyed&&e.data.keepAlive){const t=e;Nt.prepatch(t,t);}else {(e.componentInstance=Mt(e,null)).$mount(t?e.elm:void 0,t);}},prepatch(e,t){const n=t.componentOptions;!function(e,t,n,s,o){const i=s.data.scopedSlots,c=e.$scopedSlots,a=!!(i&&!i.$stable||c!==r&&!c.$stable||i&&e.$scopedSlots.$key!==i.$key||!i&&e.$scopedSlots.$key);let l=!!(o||e.$options._renderChildren||a);const u=e.$vnode;e.$options._parentVnode=s,e.$vnode=s,e._vnode&&(e._vnode.parent=s),e.$options._renderChildren=o;const f=s.data.attrs||r;e._attrsProxy&&ut(e._attrsProxy,f,u.data&&u.data.attrs||r,e,"$attrs")&&(l=!0),e.$attrs=f,n=n||r;const p=e.$options._parentListeners;if(e._listenersProxy&&ut(e._listenersProxy,n,p||r,e,"$listeners"),e.$listeners=e.$options._parentListeners=n,gt(e,n,p),t&&e.$options.props){Ce(!1);const n=e._props,r=e.$options._propKeys||[];for(let s=0;s<r.length;s++){const o=r[s],i=e.$options.props;n[o]=Ht(o,i,t,e);}Ce(!0),e.$options.propsData=t;}l&&(e.$slots=st(o,s.context),e.$forceUpdate());}(t.componentInstance=e.componentInstance,n.propsData,n.listeners,t,n.children);},insert(e){const{context:t,componentInstance:n}=e;n._isMounted||(n._isMounted=!0,bt(n,"mounted")),e.data.keepAlive&&(t._isMounted?function(e){e._inactive=!1;}(n):$t(n,!0));},destroy(e){const{componentInstance:t}=e;t._isDestroyed||(e.data.keepAlive?vt(t,!0):t.$destroy());}},Et=Object.keys(Nt);function It(e,t,n,a,l){if(o(e))return;const f=n.$options._base;if(u(e)&&(e=f.extend(e)),"function"!=typeof e)return;let p;if(o(e.cid)&&(p=e,void 0===(e=c((d=p).error)&&i(d.errorComp)?d.errorComp:i(d.resolved)?d.resolved:c(d.loading)&&i(d.loadingComp)?d.loadingComp:void 0)))return function(e,t,n,r,s){const o=X();return o.asyncFactory=e,o.asyncMeta={data:t,context:n,children:r,tag:s},o}(p,t,n,a,l);var d;t=t||{},At(e),i(t.model)&&function(e,t){const n=e.model&&e.model.prop||"value",r=e.model&&e.model.event||"input";(t.attrs||(t.attrs={}))[n]=t.model.value;const o=t.on||(t.on={}),c=o[r],a=t.model.callback;i(c)?(s(c)?-1===c.indexOf(a):c!==a)&&(o[r]=[a].concat(c)):o[r]=a;}(e.options,t);const h=function(e,t,n){const r=t.options.props;if(o(r))return;const s={},{attrs:c,props:a}=e;if(i(c)||i(a))for(const e in r){const t=k(e);Re(s,a,e,t,!0)||Re(s,c,e,t,!1);}return s}(t,e);if(c(e.options.functional))return function(e,t,n,o,c){const a=e.options,l={},u=a.props;if(i(u))for(const e in u)l[e]=Ht(e,u,t||r);else i(n.attrs)&&Pt(l,n.attrs),i(n.props)&&Pt(l,n.props);const f=new jt(n,l,c,o,e),p=a.render.call(null,f._c,f);if(p instanceof Q)return Ft(p,n,f.parent,a);if(s(p)){const e=Le(p)||[],t=new Array(e.length);for(let r=0;r<e.length;r++)t[r]=Ft(e[r],n,f.parent,a);return t}}(e,h,t,n,a);const m=t.on;if(t.on=t.nativeOn,c(e.options.abstract)){const e=t.slot;t={},e&&(t.slot=e);}!function(e){const t=e.hook||(e.hook={});for(let e=0;e<Et.length;e++){const n=Et[e],r=t[n],s=Nt[n];r===s||r&&r._merged||(t[n]=r?Rt(s,r):s);}}(t);const g=(y=e.options).name||y.__name||y._componentTag||l;var y;return new Q(`vue-component-${e.cid}${g?`-${g}`:""}`,t,void 0,void 0,void 0,n,{Ctor:e,propsData:h,listeners:m,tag:l,children:a},p)}function Mt(e,t){const n={_isComponent:!0,_parentVnode:e,parent:t},r=e.data.inlineTemplate;return i(r)&&(n.render=r.render,n.staticRenderFns=r.staticRenderFns),new e.componentOptions.Ctor(n)}function Rt(e,t){const n=(n,r)=>{e(n,r),t(n,r);};return n._merged=!0,n}const Dt=he.optionMergeStrategies;function Lt(e,t){if(!t)return e;let n,r,s;const o=fe?Reflect.ownKeys(t):Object.keys(t);for(let i=0;i<o.length;i++)n=o[i],"__ob__"!==n&&(r=e[n],s=t[n],v(e,n)?r!==s&&p(r)&&p(s)&&Lt(r,s):Pe(e,n,s));return e}function zt(e,t,n){return n?function(){const r=l(t)?t.call(n,n):t,s=l(e)?e.call(n,n):e;return r?Lt(r,s):s}:t?e?function(){return Lt(l(t)?t.call(this,this):t,l(e)?e.call(this,this):e)}:t:e}function Bt(e,t){const n=t?e?e.concat(t):s(t)?t:[t]:e;return n?function(e){const t=[];for(let n=0;n<e.length;n++)-1===t.indexOf(e[n])&&t.push(e[n]);return t}(n):n}function Ut(e,t,n,r){const s=Object.create(e||null);return t?O(s,t):s}Dt.data=function(e,t,n){return n?zt(e,t,n):t&&"function"!=typeof t?e:zt(e,t)},de.forEach((e=>{Dt[e]=Bt;})),["component","directive","filter"].forEach((function(e){Dt[e+"s"]=Ut;})),Dt.watch=function(e,t,n,r){if(e===ie&&(e=void 0),t===ie&&(t=void 0),!t)return Object.create(e||null);if(!e)return t;const o={};O(o,e);for(const e in t){let n=o[e];const r=t[e];n&&!s(n)&&(n=[n]),o[e]=n?n.concat(r):s(r)?r:[r];}return o},Dt.props=Dt.methods=Dt.inject=Dt.computed=function(e,t,n,r){if(!e)return t;const s=Object.create(null);return O(s,e),t&&O(s,t),s},Dt.provide=zt;const qt=function(e,t){return void 0===t?e:t};function Jt(e,t,n){if(l(t)&&(t=t.options),function(e,t){const n=e.props;if(!n)return;const r={};let o,i,c;if(s(n))for(o=n.length;o--;)i=n[o],"string"==typeof i&&(c=x(i),r[c]={type:null});else if(p(n))for(const e in n)i=n[e],c=x(e),r[c]=p(i)?i:{type:i};e.props=r;}(t),function(e,t){const n=e.inject;if(!n)return;const r=e.inject={};if(s(n))for(let e=0;e<n.length;e++)r[n[e]]={from:n[e]};else if(p(n))for(const e in n){const t=n[e];r[e]=p(t)?O({from:e},t):{from:t};}}(t),function(e){const t=e.directives;if(t)for(const e in t){const n=t[e];l(n)&&(t[e]={bind:n,update:n});}}(t),!t._base&&(t.extends&&(e=Jt(e,t.extends,n)),t.mixins))for(let r=0,s=t.mixins.length;r<s;r++)e=Jt(e,t.mixins[r],n);const r={};let o;for(o in e)i(o);for(o in t)v(e,o)||i(o);function i(s){const o=Dt[s]||qt;r[s]=o(e[s],t[s],n,s);}return r}function Kt(e,t,n,r){if("string"!=typeof n)return;const s=e[t];if(v(s,n))return s[n];const o=x(n);if(v(s,o))return s[o];const i=w(o);if(v(s,i))return s[i];return s[n]||s[o]||s[i]}function Ht(e,t,n,r){const s=t[e],o=!v(n,e);let i=n[e];const c=Gt(Boolean,s.type);if(c>-1)if(o&&!v(s,"default"))i=!1;else if(""===i||i===k(e)){const e=Gt(String,s.type);(e<0||c<e)&&(i=!0);}if(void 0===i){i=function(e,t,n){if(!v(t,"default"))return;const r=t.default;if(e&&e.$options.propsData&&void 0===e.$options.propsData[n]&&void 0!==e._props[n])return e._props[n];return l(r)&&"Function"!==Zt(t.type)?r.call(e):r}(r,s,e);const t=Oe;Ce(!0),je(i),Ce(t);}return i}const Vt=/^\s*function (\w+)/;function Zt(e){const t=e&&e.toString().match(Vt);return t?t[1]:""}function Wt(e,t){return Zt(e)===Zt(t)}function Gt(e,t){if(!s(t))return Wt(t,e)?0:-1;for(let n=0,r=t.length;n<r;n++)if(Wt(t[n],e))return n;return -1}function Qt(e,t){return {staticClass:Yt(e.staticClass,t.staticClass),class:i(e.class)?[e.class,t.class]:t.class}}function Xt(e,t){return i(e)||i(t)?Yt(e,en(t)):""}function Yt(e,t){return e?t?e+" "+t:e:t||""}function en(e){return Array.isArray(e)?function(e){let t,n="";for(let r=0,s=e.length;r<s;r++)i(t=en(e[r]))&&""!==t&&(n&&(n+=" "),n+=t);return n}(e):u(e)?function(e){let t="";for(const n in e)e[n]&&(t&&(t+=" "),t+=n);return t}(e):"string"==typeof e?e:""}const tn=m("html,body,base,head,link,meta,style,title,address,article,aside,footer,header,h1,h2,h3,h4,h5,h6,hgroup,nav,section,div,dd,dl,dt,figcaption,figure,picture,hr,img,li,main,ol,p,pre,ul,a,b,abbr,bdi,bdo,br,cite,code,data,dfn,em,i,kbd,mark,q,rp,rt,rtc,ruby,s,samp,small,span,strong,sub,sup,time,u,var,wbr,area,audio,map,track,video,embed,object,param,source,canvas,script,noscript,del,ins,caption,col,colgroup,table,thead,tbody,td,th,tr,button,datalist,fieldset,form,input,label,legend,meter,optgroup,option,output,progress,select,textarea,details,dialog,menu,menuitem,summary,content,element,shadow,template,blockquote,iframe,tfoot"),nn=m("svg,animate,circle,clippath,cursor,defs,desc,ellipse,filter,font-face,foreignobject,g,glyph,image,line,marker,mask,missing-glyph,path,pattern,polygon,polyline,rect,switch,symbol,text,textpath,tspan,use,view",!0);const rn=b((function(e){const t={},n=/:(.+)/;return e.split(/;(?![^(]*\))/g).forEach((function(e){if(e){const r=e.split(n);r.length>1&&(t[r[0].trim()]=r[1].trim());}})),t}));function sn(e){const t=on(e.style);return e.staticStyle?O(e.staticStyle,t):t}function on(e){return Array.isArray(e)?C(e):"string"==typeof e?rn(e):e}function cn(e){let t="";for(const n in e){const r=e[n],s=k(n);if(Array.isArray(r))for(let e=0,n=r.length;e<n;e++)t+=an(s,r[e]);else t+=an(s,r);}return t}function an(e,t){return "string"==typeof t||"number"==typeof t&&U[e]||0===t?`${e}:${t};`:""}var ln=[function(e){let t=e.data.attrs,n="";const r=e.parent&&e.parent.componentOptions;if(o(r)||!1!==r.Ctor.options.inheritAttrs){let n=e.parent;for(;i(n)&&(!n.componentOptions||!1!==n.componentOptions.Ctor.options.inheritAttrs);)i(n.data)&&i(n.data.attrs)&&(t=O(O({},t),n.data.attrs)),n=n.parent;}if(o(t))return n;for(const e in t)M(e)||"style"!==e&&(n+=G(e,t[e]));return n},function(e){let t=e.data.domProps,n="",r=e.parent;for(;i(r);)r.data&&r.data.domProps&&(t=O(O({},t),r.data.domProps)),r=r.parent;if(o(t))return n;const s=e.data.attrs;for(const r in t)if("innerHTML"===r)ee(e,t[r],!0);else if("textContent"===r)ee(e,t[r],!1);else if("value"===r&&"textarea"===e.tag)ee(e,d(t[r]),!1);else {const e=D[r]||r.toLowerCase();!R(e)||i(s)&&i(s[e])||(n+=G(e,t[r]));}return n},function(e){const t=function(e){let t=e.data,n=e,r=e;for(;i(r.componentInstance);)r=r.componentInstance._vnode,r&&r.data&&(t=Qt(r.data,t));for(;i(n=n.parent);)n&&n.data&&(t=Qt(t,n.data));return Xt(t.staticClass,t.class)}(e);if(""!==t)return ` class="${z(t)}"`},function(e){const t=cn(function(e,t){const n={};let r;if(t){let t=e;for(;t.componentInstance;)t=t.componentInstance._vnode,t&&t.data&&(r=sn(t.data))&&O(n,r);}(r=sn(e.data))&&O(n,r);let s=e;for(;s=s.parent;)s.data&&(r=sn(s.data))&&O(n,r);return n}(e,!1));if(""!==t)return ` style=${JSON.stringify(z(t))}`}];function un(e){const t=e.data||{};return t.attrs&&t.attrs.value||t.domProps&&t.domProps.value||e.children&&e.children[0]&&e.children[0].text}function fn(e){const t=e.data||(e.data={});(t.attrs||(t.attrs={})).selected="";}var pn={show:function(e,t){if(!t.value){const t=e.data.style||(e.data.style={});Array.isArray(t)?t.push({display:"none"}):t.display="none";}},model:function(e,t){if(!e.children)return;const n=t.value,r=e.data.attrs&&e.data.attrs.multiple;for(let t=0,s=e.children.length;t<s;t++){const s=e.children[t];if("option"===s.tag)if(r){Array.isArray(n)&&P(n,un(s))>-1&&fn(s);}else if(F(n,un(s)))return void fn(s)}}};const dn=m("area,base,br,col,embed,frame,hr,img,input,isindex,keygen,link,meta,param,source,track,wbr"),hn=m("colgroup,dd,dt,li,options,p,td,tfoot,th,thead,tr,source"),mn=m("address,article,aside,base,blockquote,body,caption,col,colgroup,dd,details,dialog,div,dl,dt,fieldset,figcaption,figure,footer,form,h1,h2,h3,h4,h5,h6,head,header,hgroup,hr,html,legend,li,menuitem,meta,optgroup,option,param,rp,rt,source,style,summary,tbody,td,tfoot,th,thead,title,tr,track"),gn=e=>e,yn="undefined"!=typeof process&&process.nextTick?process.nextTick:"undefined"!=typeof Promise?e=>Promise.resolve().then(e):"undefined"!=typeof setTimeout?setTimeout:gn;if(yn===gn)throw new Error("Your JavaScript runtime does not support any asynchronous primitives that are required by vue-server-renderer. Please use a polyfill for either Promise or setTimeout.");function $n(e,t){let n=0;const r=(s,o)=>{s&&r.caching&&(r.cacheBuffer[r.cacheBuffer.length-1]+=s);!0!==e(s,o)&&(n>=800?yn((()=>{try{o();}catch(e){t(e);}})):(n++,o(),n--));};return r.caching=!1,r.cacheBuffer=[],r.componentBuffer=[],r}class vn extends e.Readable{constructor(e){super(),this.buffer="",this.render=e,this.expectedSize=0,this.write=$n(((e,t)=>{const n=this.expectedSize;return this.buffer+=e,this.buffer.length>=n&&(this.next=t,this.pushBySize(n),!0)}),(e=>{this.emit("error",e);})),this.end=()=>{this.emit("beforeEnd"),this.done=!0,this.push(this.buffer);};}pushBySize(e){const t=this.buffer.substring(0,e);this.buffer=this.buffer.substring(e),this.push(t);}tryRender(){try{this.render(this.write,this.end);}catch(e){this.emit("error",e);}}tryNext(){try{this.next();}catch(e){this.emit("error",e);}}_read(e){this.expectedSize=e,c(this.done)?this.push(null):this.buffer.length>=e?this.pushBySize(e):o(this.next)?this.tryRender():this.tryNext();}}class bn{constructor(e){this.userContext=e.userContext,this.activeInstance=e.activeInstance,this.renderStates=[],this.write=e.write,this.done=e.done,this.renderNode=e.renderNode,this.isUnaryTag=e.isUnaryTag,this.modules=e.modules,this.directives=e.directives;const t=e.cache;if(t&&(!t.get||!t.set))throw new Error("renderer cache must implement at least get & set.");this.cache=t,this.get=t&&_n(t,"get"),this.has=t&&_n(t,"has"),this.next=this.next.bind(this);}next(){for(;;){const e=this.renderStates[this.renderStates.length-1];if(o(e))return this.done();switch(e.type){case"Element":case"Fragment":const{children:t,total:n}=e,r=e.rendered++;if(r<n)return this.renderNode(t[r],!1,this);if(this.renderStates.pop(),"Element"===e.type)return this.write(e.endTag,this.next);break;case"Component":this.renderStates.pop(),this.activeInstance=e.prevActive;break;case"ComponentWithCache":this.renderStates.pop();const{buffer:s,bufferIndex:o,componentBuffer:i,key:c}=e,a={html:s[o],components:i[o]};if(this.cache.set(c,a),0===o)this.write.caching=!1;else {s[o-1]+=a.html;const e=i[o-1];a.components.forEach((t=>e.add(t)));}s.length=o,i.length=o;}}}}function _n(e,t){const n=e[t];return o(n)?void 0:n.length>1?(t,r)=>n.call(e,t,r):(t,r)=>r(n.call(e,t))}const xn=/[\w).+\-_$\]]/;function wn(e){let t,n,r,s,o,i=!1,c=!1,a=!1,l=!1,u=0,f=0,p=0,d=0;for(r=0;r<e.length;r++)if(n=t,t=e.charCodeAt(r),i)39===t&&92!==n&&(i=!1);else if(c)34===t&&92!==n&&(c=!1);else if(a)96===t&&92!==n&&(a=!1);else if(l)47===t&&92!==n&&(l=!1);else if(124!==t||124===e.charCodeAt(r+1)||124===e.charCodeAt(r-1)||u||f||p){switch(t){case 34:c=!0;break;case 39:i=!0;break;case 96:a=!0;break;case 40:p++;break;case 41:p--;break;case 91:f++;break;case 93:f--;break;case 123:u++;break;case 125:u--;}if(47===t){let t,n=r-1;for(;n>=0&&(t=e.charAt(n)," "===t);n--);t&&xn.test(t)||(l=!0);}}else void 0===s?(d=r+1,s=e.slice(0,r).trim()):h();function h(){(o||(o=[])).push(e.slice(d,r).trim()),d=r+1;}if(void 0===s?s=e.slice(0,r).trim():0!==d&&h(),o)for(r=0;r<o.length;r++)s=Sn(s,o[r]);return s}function Sn(e,t){const n=t.indexOf("(");if(n<0)return `_f("${t}")(${e})`;{const r=t.slice(0,n),s=t.slice(n+1);return `_f("${r}")(${e}${")"!==s?","+s:s}`}}const kn=/\{\{((?:.|\r?\n)+?)\}\}/g,On=/[-.*+?^${}()|[\]\/\\]/g,Cn=b((e=>{const t=e[0].replace(On,"\\$&"),n=e[1].replace(On,"\\$&");return new RegExp(t+"((?:.|\\n)+?)"+n,"g")}));function Tn(e,t){console.error(`[Vue compiler]: ${e}`);}function An(e,t){return e?e.map((e=>e[t])).filter((e=>e)):[]}function jn(e,t,n,r,s){(e.props||(e.props=[])).push(Ln({name:t,value:n,dynamic:s},r)),e.plain=!1;}function Fn(e,t,n,r,s){(s?e.dynamicAttrs||(e.dynamicAttrs=[]):e.attrs||(e.attrs=[])).push(Ln({name:t,value:n,dynamic:s},r)),e.plain=!1;}function Pn(e,t,n,r){e.attrsMap[t]=n,e.attrsList.push(Ln({name:t,value:n},r));}function Nn(e,t,n,r,s,o,i,c){(e.directives||(e.directives=[])).push(Ln({name:t,rawName:n,value:r,arg:s,isDynamicArg:o,modifiers:i},c)),e.plain=!1;}function En(e,t,n){return n?`_p(${t},"${e}")`:e+t}function In(e,t,n,s,o,i,c,a){let l;(s=s||r).right?a?t=`(${t})==='click'?'contextmenu':(${t})`:"click"===t&&(t="contextmenu",delete s.right):s.middle&&(a?t=`(${t})==='click'?'mouseup':(${t})`:"click"===t&&(t="mouseup")),s.capture&&(delete s.capture,t=En("!",t,a)),s.once&&(delete s.once,t=En("~",t,a)),s.passive&&(delete s.passive,t=En("&",t,a)),s.native?(delete s.native,l=e.nativeEvents||(e.nativeEvents={})):l=e.events||(e.events={});const u=Ln({value:n.trim(),dynamic:a},c);s!==r&&(u.modifiers=s);const f=l[t];Array.isArray(f)?o?f.unshift(u):f.push(u):l[t]=f?o?[u,f]:[f,u]:u,e.plain=!1;}function Mn(e,t,n){const r=Rn(e,":"+t)||Rn(e,"v-bind:"+t);if(null!=r)return wn(r);if(!1!==n){const n=Rn(e,t);if(null!=n)return JSON.stringify(n)}}function Rn(e,t,n){let r;if(null!=(r=e.attrsMap[t])){const n=e.attrsList;for(let e=0,r=n.length;e<r;e++)if(n[e].name===t){n.splice(e,1);break}}return n&&delete e.attrsMap[t],r}function Dn(e,t){const n=e.attrsList;for(let e=0,r=n.length;e<r;e++){const r=n[e];if(t.test(r.name))return n.splice(e,1),r}}function Ln(e,t){return t&&(null!=t.start&&(e.start=t.start),null!=t.end&&(e.end=t.end)),e}var zn={staticKeys:["staticClass"],transformNode:function(e,t){t.warn;const n=Rn(e,"class");n&&(e.staticClass=JSON.stringify(n.replace(/\s+/g," ").trim()));const r=Mn(e,"class",!1);r&&(e.classBinding=r);},genData:function(e){let t="";return e.staticClass&&(t+=`staticClass:${e.staticClass},`),e.classBinding&&(t+=`class:${e.classBinding},`),t}};var Bn={staticKeys:["staticStyle"],transformNode:function(e,t){t.warn;const n=Rn(e,"style");n&&(e.staticStyle=JSON.stringify(rn(n)));const r=Mn(e,"style",!1);r&&(e.styleBinding=r);},genData:function(e){let t="";return e.staticStyle&&(t+=`staticStyle:${e.staticStyle},`),e.styleBinding&&(t+=`style:(${e.styleBinding}),`),t}};const Un=/^\s*([^\s"'<>\/=]+)(?:\s*(=)\s*(?:"([^"]*)"+|'([^']*)'+|([^\s"'=<>`]+)))?/,qn=/^\s*((?:v-[\w-]+:|@|:|#)\[[^=]+?\][^\s"'<>\/=]*)(?:\s*(=)\s*(?:"([^"]*)"+|'([^']*)'+|([^\s"'=<>`]+)))?/,Jn=`[a-zA-Z_][\\-\\.0-9_a-zA-Z${/a-zA-Z\u00B7\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u037D\u037F-\u1FFF\u200C-\u200D\u203F-\u2040\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD/.source}]*`,Kn=`((?:${Jn}\\:)?${Jn})`,Hn=new RegExp(`^<${Kn}`),Vn=/^\s*(\/?)>/,Zn=new RegExp(`^<\\/${Kn}[^>]*>`),Wn=/^<!DOCTYPE [^>]+>/i,Gn=/^<!\--/,Qn=/^<!\[/,Xn=m("script,style,textarea",!0),Yn={},er={"&lt;":"<","&gt;":">","&quot;":'"',"&amp;":"&","&#10;":"\n","&#9;":"\t","&#39;":"'"},tr=/&(?:lt|gt|quot|amp|#39);/g,nr=/&(?:lt|gt|quot|amp|#39|#10|#9);/g,rr=m("pre,textarea",!0),sr=(e,t)=>e&&rr(e)&&"\n"===t[0];function or(e,t){const n=t?nr:tr;return e.replace(n,(e=>er[e]))}function ir(e,t,n){const{number:r,trim:s}=n||{},o="$$v";let i=o;s&&(i="(typeof $$v === 'string'? $$v.trim(): $$v)"),r&&(i=`_n(${i})`);const c=cr(t,i);e.model={value:`(${t})`,expression:JSON.stringify(t),callback:`function ($$v) {${c}}`};}function cr(e,t){const n=function(e){if(e=e.trim(),ar=e.length,e.indexOf("[")<0||e.lastIndexOf("]")<ar-1)return fr=e.lastIndexOf("."),fr>-1?{exp:e.slice(0,fr),key:'"'+e.slice(fr+1)+'"'}:{exp:e,key:null};lr=e,fr=pr=dr=0;for(;!mr();)ur=hr(),gr(ur)?$r(ur):91===ur&&yr(ur);return {exp:e.slice(0,pr),key:e.slice(pr+1,dr)}}(e);return null===n.key?`${e}=${t}`:`$set(${n.exp}, ${n.key}, ${t})`}let ar,lr,ur,fr,pr,dr;function hr(){return lr.charCodeAt(++fr)}function mr(){return fr>=ar}function gr(e){return 34===e||39===e}function yr(e){let t=1;for(pr=fr;!mr();)if(gr(e=hr()))$r(e);else if(91===e&&t++,93===e&&t--,0===t){dr=fr;break}}function $r(e){const t=e;for(;!mr()&&(e=hr())!==t;);}const vr=/^@|^v-on:/,br=/^v-|^@|^:|^#/,_r=/([\s\S]*?)\s+(?:in|of)\s+([\s\S]*)/,xr=/,([^,\}\]]*)(?:,([^,\}\]]*))?$/,wr=/^\(|\)$/g,Sr=/^\[.*\]$/,kr=/:(.*)$/,Or=/^:|^\.|^v-bind:/,Cr=/\.[^.\]]+(?=[^\]]*$)/g,Tr=/^v-slot(:|$)|^#/,Ar=/[\r\n]/,jr=/[ \f\t\r\n]+/g,Fr=b(n.default.decode);let Pr,Nr,Er,Ir,Mr,Rr,Dr,Lr;function zr(e,t,n){return {type:1,tag:e,attrsList:t,attrsMap:Vr(t),rawAttrsMap:{},parent:n,children:[]}}function Br(e,t){Pr=t.warn||Tn,Rr=t.isPreTag||A,Dr=t.mustUseProp||A,Lr=t.getTagNamespace||A,t.isReservedTag,Er=An(t.modules,"transformNode"),Ir=An(t.modules,"preTransformNode"),Mr=An(t.modules,"postTransformNode"),Nr=t.delimiters;const n=[],r=!1!==t.preserveWhitespace,s=t.whitespace;let o,i,c=!1,a=!1;function l(e){if(u(e),c||e.processed||(e=Ur(e,t)),n.length||e===o||o.if&&(e.elseif||e.else)&&Jr(o,{exp:e.elseif,block:e}),i&&!e.forbidden)if(e.elseif||e.else)!function(e,t){const n=function(e){let t=e.length;for(;t--;){if(1===e[t].type)return e[t];e.pop();}}(t.children);n&&n.if&&Jr(n,{exp:e.elseif,block:e});}(e,i);else {if(e.slotScope){const t=e.slotTarget||'"default"';(i.scopedSlots||(i.scopedSlots={}))[t]=e;}i.children.push(e),e.parent=i;}e.children=e.children.filter((e=>!e.slotScope)),u(e),e.pre&&(c=!1),Rr(e.tag)&&(a=!1);for(let n=0;n<Mr.length;n++)Mr[n](e,t);}function u(e){if(!a){let t;for(;(t=e.children[e.children.length-1])&&3===t.type&&" "===t.text;)e.children.pop();}}return function(e,t){const n=[],r=t.expectHTML,s=t.isUnaryTag||A,o=t.canBeLeftOpenTag||A;let i,c,a=0;for(;e;){if(i=e,c&&Xn(c)){let n=0;const r=c.toLowerCase(),s=Yn[r]||(Yn[r]=new RegExp("([\\s\\S]*?)(</"+r+"[^>]*>)","i")),o=e.replace(s,(function(e,s,o){return n=o.length,Xn(r)||"noscript"===r||(s=s.replace(/<!\--([\s\S]*?)-->/g,"$1").replace(/<!\[CDATA\[([\s\S]*?)]]>/g,"$1")),sr(r,s)&&(s=s.slice(1)),t.chars&&t.chars(s),""}));a+=e.length-o.length,e=o,p(r,a-n,a);}else {let n,r,s,o=e.indexOf("<");if(0===o){if(Gn.test(e)){const n=e.indexOf("--\x3e");if(n>=0){t.shouldKeepComment&&t.comment&&t.comment(e.substring(4,n),a,a+n+3),l(n+3);continue}}if(Qn.test(e)){const t=e.indexOf("]>");if(t>=0){l(t+2);continue}}const n=e.match(Wn);if(n){l(n[0].length);continue}const r=e.match(Zn);if(r){const e=a;l(r[0].length),p(r[1],e,a);continue}const s=u();if(s){f(s),sr(s.tagName,e)&&l(1);continue}}if(o>=0){for(r=e.slice(o);!(Zn.test(r)||Hn.test(r)||Gn.test(r)||Qn.test(r)||(s=r.indexOf("<",1),s<0));)o+=s,r=e.slice(o);n=e.substring(0,o);}o<0&&(n=e),n&&l(n.length),t.chars&&n&&t.chars(n,a-n.length,a);}if(e===i){t.chars&&t.chars(e);break}}function l(t){a+=t,e=e.substring(t);}function u(){const t=e.match(Hn);if(t){const n={tagName:t[1],attrs:[],start:a};let r,s;for(l(t[0].length);!(r=e.match(Vn))&&(s=e.match(qn)||e.match(Un));)s.start=a,l(s[0].length),s.end=a,n.attrs.push(s);if(r)return n.unarySlash=r[1],l(r[0].length),n.end=a,n}}function f(e){const i=e.tagName,a=e.unarySlash;r&&("p"===c&&mn(i)&&p(c),o(i)&&c===i&&p(i));const l=s(i)||!!a,u=e.attrs.length,f=new Array(u);for(let n=0;n<u;n++){const r=e.attrs[n],s=r[3]||r[4]||r[5]||"",o="a"===i&&"href"===r[1]?t.shouldDecodeNewlinesForHref:t.shouldDecodeNewlines;f[n]={name:r[1],value:or(s,o)};}l||(n.push({tag:i,lowerCasedTag:i.toLowerCase(),attrs:f,start:e.start,end:e.end}),c=i),t.start&&t.start(i,f,l,e.start,e.end);}function p(e,r,s){let o,i;if(null==r&&(r=a),null==s&&(s=a),e)for(i=e.toLowerCase(),o=n.length-1;o>=0&&n[o].lowerCasedTag!==i;o--);else o=0;if(o>=0){for(let e=n.length-1;e>=o;e--)t.end&&t.end(n[e].tag,r,s);n.length=o,c=o&&n[o-1].tag;}else "br"===i?t.start&&t.start(e,[],!0,r,s):"p"===i&&(t.start&&t.start(e,[],!1,r,s),t.end&&t.end(e,r,s));}p();}(e,{warn:Pr,expectHTML:t.expectHTML,isUnaryTag:t.isUnaryTag,canBeLeftOpenTag:t.canBeLeftOpenTag,shouldDecodeNewlines:t.shouldDecodeNewlines,shouldDecodeNewlinesForHref:t.shouldDecodeNewlinesForHref,shouldKeepComment:t.comments,outputSourceRange:t.outputSourceRange,start(e,r,s,u,f){const p=i&&i.ns||Lr(e);let d=zr(e,r,i);var h;p&&(d.ns=p),"style"!==(h=d).tag&&("script"!==h.tag||h.attrsMap.type&&"text/javascript"!==h.attrsMap.type)||le()||(d.forbidden=!0);for(let e=0;e<Ir.length;e++)d=Ir[e](d,t)||d;c||(!function(e){null!=Rn(e,"v-pre")&&(e.pre=!0);}(d),d.pre&&(c=!0)),Rr(d.tag)&&(a=!0),c?function(e){const t=e.attrsList,n=t.length;if(n){const r=e.attrs=new Array(n);for(let e=0;e<n;e++)r[e]={name:t[e].name,value:JSON.stringify(t[e].value)},null!=t[e].start&&(r[e].start=t[e].start,r[e].end=t[e].end);}else e.pre||(e.plain=!0);}(d):d.processed||(qr(d),function(e){const t=Rn(e,"v-if");if(t)e.if=t,Jr(e,{exp:t,block:e});else {null!=Rn(e,"v-else")&&(e.else=!0);const t=Rn(e,"v-else-if");t&&(e.elseif=t);}}(d),function(e){null!=Rn(e,"v-once")&&(e.once=!0);}(d)),o||(o=d),s?l(d):(i=d,n.push(d));},end(e,t,r){const s=n[n.length-1];n.length-=1,i=n[n.length-1],l(s);},chars(e,t,n){if(!i)return;const o=i.children;var l;if(e=a||e.trim()?"script"===(l=i).tag||"style"===l.tag?e:Fr(e):o.length?s?"condense"===s&&Ar.test(e)?"":" ":r?" ":"":""){let t,n;a||"condense"!==s||(e=e.replace(jr," ")),!c&&" "!==e&&(t=function(e,t){const n=t?Cn(t):kn;if(!n.test(e))return;const r=[],s=[];let o,i,c,a=n.lastIndex=0;for(;o=n.exec(e);){i=o.index,i>a&&(s.push(c=e.slice(a,i)),r.push(JSON.stringify(c)));const t=wn(o[1].trim());r.push(`_s(${t})`),s.push({"@binding":t}),a=i+o[0].length;}return a<e.length&&(s.push(c=e.slice(a)),r.push(JSON.stringify(c))),{expression:r.join("+"),tokens:s}}(e,Nr))?n={type:2,expression:t.expression,tokens:t.tokens,text:e}:" "===e&&o.length&&" "===o[o.length-1].text||(n={type:3,text:e}),n&&o.push(n);}},comment(e,t,n){if(i){const t={type:3,text:e,isComment:!0};i.children.push(t);}}}),o}function Ur(e,t){var n;!function(e){const t=Mn(e,"key");t&&(e.key=t);}(e),e.plain=!e.key&&!e.scopedSlots&&!e.attrsList.length,function(e){const t=Mn(e,"ref");t&&(e.ref=t,e.refInFor=function(e){let t=e;for(;t;){if(void 0!==t.for)return !0;t=t.parent;}return !1}(e));}(e),function(e){let t;"template"===e.tag?(t=Rn(e,"scope"),e.slotScope=t||Rn(e,"slot-scope")):(t=Rn(e,"slot-scope"))&&(e.slotScope=t);const n=Mn(e,"slot");n&&(e.slotTarget='""'===n?'"default"':n,e.slotTargetDynamic=!(!e.attrsMap[":slot"]&&!e.attrsMap["v-bind:slot"]),"template"===e.tag||e.slotScope||Fn(e,"slot",n,function(e,t){return e.rawAttrsMap[":"+t]||e.rawAttrsMap["v-bind:"+t]||e.rawAttrsMap[t]}(e,"slot")));if("template"===e.tag){const t=Dn(e,Tr);if(t){const{name:n,dynamic:r}=Kr(t);e.slotTarget=n,e.slotTargetDynamic=r,e.slotScope=t.value||"_empty_";}}else {const t=Dn(e,Tr);if(t){const n=e.scopedSlots||(e.scopedSlots={}),{name:r,dynamic:s}=Kr(t),o=n[r]=zr("template",[],e);o.slotTarget=r,o.slotTargetDynamic=s,o.children=e.children.filter((e=>{if(!e.slotScope)return e.parent=o,!0})),o.slotScope=t.value||"_empty_",e.children=[],e.plain=!1;}}}(e),"slot"===(n=e).tag&&(n.slotName=Mn(n,"name")),function(e){let t;(t=Mn(e,"is"))&&(e.component=t);null!=Rn(e,"inline-template")&&(e.inlineTemplate=!0);}(e);for(let n=0;n<Er.length;n++)e=Er[n](e,t)||e;return function(e){const t=e.attrsList;let n,r,s,o,i,c,a,l;for(n=0,r=t.length;n<r;n++)if(s=o=t[n].name,i=t[n].value,br.test(s))if(e.hasBindings=!0,c=Hr(s.replace(br,"")),c&&(s=s.replace(Cr,"")),Or.test(s))s=s.replace(Or,""),i=wn(i),l=Sr.test(s),l&&(s=s.slice(1,-1)),c&&(c.prop&&!l&&(s=x(s),"innerHtml"===s&&(s="innerHTML")),c.camel&&!l&&(s=x(s)),c.sync&&(a=cr(i,"$event"),l?In(e,`"update:"+(${s})`,a,null,!1,0,t[n],!0):(In(e,`update:${x(s)}`,a,null,!1,0,t[n]),k(s)!==x(s)&&In(e,`update:${k(s)}`,a,null,!1,0,t[n])))),c&&c.prop||!e.component&&Dr(e.tag,e.attrsMap.type,s)?jn(e,s,i,t[n],l):Fn(e,s,i,t[n],l);else if(vr.test(s))s=s.replace(vr,""),l=Sr.test(s),l&&(s=s.slice(1,-1)),In(e,s,i,c,!1,0,t[n],l);else {s=s.replace(br,"");const r=s.match(kr);let a=r&&r[1];l=!1,a&&(s=s.slice(0,-(a.length+1)),Sr.test(a)&&(a=a.slice(1,-1),l=!0)),Nn(e,s,o,i,a,l,c,t[n]);}else Fn(e,s,JSON.stringify(i),t[n]),!e.component&&"muted"===s&&Dr(e.tag,e.attrsMap.type,s)&&jn(e,s,"true",t[n]);}(e),e}function qr(e){let t;if(t=Rn(e,"v-for")){const n=function(e){const t=e.match(_r);if(!t)return;const n={};n.for=t[2].trim();const r=t[1].trim().replace(wr,""),s=r.match(xr);s?(n.alias=r.replace(xr,"").trim(),n.iterator1=s[1].trim(),s[2]&&(n.iterator2=s[2].trim())):n.alias=r;return n}(t);n&&O(e,n);}}function Jr(e,t){e.ifConditions||(e.ifConditions=[]),e.ifConditions.push(t);}function Kr(e){let t=e.name.replace(Tr,"");return t||"#"!==e.name[0]&&(t="default"),Sr.test(t)?{name:t.slice(1,-1),dynamic:!0}:{name:`"${t}"`,dynamic:!1}}function Hr(e){const t=e.match(Cr);if(t){const e={};return t.forEach((t=>{e[t.slice(1)]=!0;})),e}}function Vr(e){const t={};for(let n=0,r=e.length;n<r;n++)t[e[n].name]=e[n].value;return t}function Gr(e){return zr(e.tag,e.attrsList.slice(),e.parent)}var Qr=[zn,Bn,{preTransformNode:function(e,t){if("input"===e.tag){const n=e.attrsMap;if(!n["v-model"])return;let r;if((n[":type"]||n["v-bind:type"])&&(r=Mn(e,"type")),n.type||r||!n["v-bind"]||(r=`(${n["v-bind"]}).type`),r){const n=Rn(e,"v-if",!0),s=n?`&&(${n})`:"",o=null!=Rn(e,"v-else",!0),i=Rn(e,"v-else-if",!0),c=Gr(e);qr(c),Pn(c,"type","checkbox"),Ur(c,t),c.processed=!0,c.if=`(${r})==='checkbox'`+s,Jr(c,{exp:c.if,block:c});const a=Gr(e);Rn(a,"v-for",!0),Pn(a,"type","radio"),Ur(a,t),Jr(c,{exp:`(${r})==='radio'`+s,block:a});const l=Gr(e);return Rn(l,"v-for",!0),Pn(l,":type",r),Ur(l,t),Jr(c,{exp:n,block:l}),o?c.else=!0:i&&(c.elseif=i),c}}}}];const Xr={expectHTML:!0,modules:Qr,directives:{model:function(e,t,n){const r=t.value,s=t.modifiers,o=e.tag,i=e.attrsMap.type;if(e.component)return ir(e,r,s),!1;if("select"===o)!function(e,t,n){const r=n&&n.number;let s=`var $$selectedVal = Array.prototype.filter.call($event.target.options,function(o){return o.selected}).map(function(o){var val = "_value" in o ? o._value : o.value;return ${r?"_n(val)":"val"}});`;s=`${s} ${cr(t,"$event.target.multiple ? $$selectedVal : $$selectedVal[0]")}`,In(e,"change",s,null,!0);}(e,r,s);else if("input"===o&&"checkbox"===i)!function(e,t,n){const r=n&&n.number,s=Mn(e,"value")||"null",o=Mn(e,"true-value")||"true",i=Mn(e,"false-value")||"false";jn(e,"checked",`Array.isArray(${t})?_i(${t},${s})>-1`+("true"===o?`:(${t})`:`:_q(${t},${o})`)),In(e,"change",`var $$a=${t},$$el=$event.target,$$c=$$el.checked?(${o}):(${i});if(Array.isArray($$a)){var $$v=${r?"_n("+s+")":s},$$i=_i($$a,$$v);if($$el.checked){$$i<0&&(${cr(t,"$$a.concat([$$v])")})}else{$$i>-1&&(${cr(t,"$$a.slice(0,$$i).concat($$a.slice($$i+1))")})}}else{${cr(t,"$$c")}}`,null,!0);}(e,r,s);else if("input"===o&&"radio"===i)!function(e,t,n){const r=n&&n.number;let s=Mn(e,"value")||"null";s=r?`_n(${s})`:s,jn(e,"checked",`_q(${t},${s})`),In(e,"change",cr(t,s),null,!0);}(e,r,s);else {if("input"!==o&&"textarea"!==o)return ir(e,r,s),!1;!function(e,t,n){const r=e.attrsMap.type,{lazy:s,number:o,trim:i}=n||{},c=!s&&"range"!==r,a=s?"change":"range"===r?"__r":"input";let l="$event.target.value";i&&(l="$event.target.value.trim()");o&&(l=`_n(${l})`);let u=cr(t,l);c&&(u=`if($event.target.composing)return;${u}`);jn(e,"value",`(${t})`),In(e,a,u,null,!0),(i||o)&&In(e,"blur","$forceUpdate()");}(e,r,s);}return !0},text:function(e,t){t.value&&jn(e,"textContent",`_s(${t.value})`,t);},html:function(e,t){t.value&&jn(e,"innerHTML",`_s(${t.value})`,t);}},isPreTag:e=>"pre"===e,isUnaryTag:dn,mustUseProp:(e,t,n)=>"value"===n&&K(e)&&"button"!==t||"selected"===n&&"option"===e||"checked"===n&&"input"===e||"muted"===n&&"video"===e,canBeLeftOpenTag:hn,isReservedTag:e=>tn(e)||nn(e),getTagNamespace:function(e){return nn(e)?"svg":"math"===e?"math":void 0},staticKeys:function(e){return e.reduce(((e,t)=>e.concat(t.staticKeys||[])),[]).join(",")}(Qr)},Yr=/^([\w$_]+|\([^)]*?\))\s*=>|^function(?:\s+[\w$]+)?\s*\(/,es=/\([^)]*?\);*$/,ts=/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\['[^']*?']|\["[^"]*?"]|\[\d+]|\[[A-Za-z_$][\w$]*])*$/,ns={esc:27,tab:9,enter:13,space:32,up:38,left:37,right:39,down:40,delete:[8,46]},rs={esc:["Esc","Escape"],tab:"Tab",enter:"Enter",space:[" ","Spacebar"],up:["Up","ArrowUp"],left:["Left","ArrowLeft"],right:["Right","ArrowRight"],down:["Down","ArrowDown"],delete:["Backspace","Delete","Del"]},ss=e=>`if(${e})return null;`,os={stop:"$event.stopPropagation();",prevent:"$event.preventDefault();",self:ss("$event.target !== $event.currentTarget"),ctrl:ss("!$event.ctrlKey"),shift:ss("!$event.shiftKey"),alt:ss("!$event.altKey"),meta:ss("!$event.metaKey"),left:ss("'button' in $event && $event.button !== 0"),middle:ss("'button' in $event && $event.button !== 1"),right:ss("'button' in $event && $event.button !== 2")};function is(e,t){const n=t?"nativeOn:":"on:";let r="",s="";for(const t in e){const n=cs(e[t]);e[t]&&e[t].dynamic?s+=`${t},${n},`:r+=`"${t}":${n},`;}return r=`{${r.slice(0,-1)}}`,s?n+`_d(${r},[${s.slice(0,-1)}])`:n+r}function cs(e){if(!e)return "function(){}";if(Array.isArray(e))return `[${e.map((e=>cs(e))).join(",")}]`;const t=ts.test(e.value),n=Yr.test(e.value),r=ts.test(e.value.replace(es,""));if(e.modifiers){let s="",o="";const i=[];for(const t in e.modifiers)if(os[t])o+=os[t],ns[t]&&i.push(t);else if("exact"===t){const t=e.modifiers;o+=ss(["ctrl","shift","alt","meta"].filter((e=>!t[e])).map((e=>`$event.${e}Key`)).join("||"));}else i.push(t);i.length&&(s+=function(e){return `if(!$event.type.indexOf('key')&&${e.map(as).join("&&")})return null;`}(i)),o&&(s+=o);return `function($event){${s}${t?`return ${e.value}.apply(null, arguments)`:n?`return (${e.value}).apply(null, arguments)`:r?`return ${e.value}`:e.value}}`}return t||n?e.value:`function($event){${r?`return ${e.value}`:e.value}}`}function as(e){const t=parseInt(e,10);if(t)return `$event.keyCode!==${t}`;const n=ns[e],r=rs[e];return `_k($event.keyCode,${JSON.stringify(e)},${JSON.stringify(n)},$event.key,${JSON.stringify(r)})`}var ls={on:function(e,t){e.wrapListeners=e=>`_g(${e},${t.value})`;},bind:function(e,t){e.wrapData=n=>`_b(${n},'${e.tag}',${t.value},${t.modifiers&&t.modifiers.prop?"true":"false"}${t.modifiers&&t.modifiers.sync?",true":""})`;},cloak:T};class us{constructor(e){this.options=e,this.warn=e.warn||Tn,this.transforms=An(e.modules,"transformCode"),this.dataGenFns=An(e.modules,"genData"),this.directives=O(O({},ls),e.directives);const t=e.isReservedTag||A;this.maybeComponent=e=>!!e.component||!t(e.tag),this.onceId=0,this.staticRenderFns=[],this.pre=!1;}}function fs(e,t){if(e.parent&&(e.pre=e.pre||e.parent.pre),e.staticRoot&&!e.staticProcessed)return ps(e,t);if(e.once&&!e.onceProcessed)return ds(e,t);if(e.for&&!e.forProcessed)return gs(e,t);if(e.if&&!e.ifProcessed)return hs(e,t);if("template"!==e.tag||e.slotTarget||t.pre){if("slot"===e.tag)return function(e,t){const n=e.slotName||'"default"',r=bs(e,t);let s=`_t(${n}${r?`,function(){return ${r}}`:""}`;const o=e.attrs||e.dynamicAttrs?Ss((e.attrs||[]).concat(e.dynamicAttrs||[]).map((e=>({name:x(e.name),value:e.value,dynamic:e.dynamic})))):null,i=e.attrsMap["v-bind"];!o&&!i||r||(s+=",null");o&&(s+=`,${o}`);i&&(s+=`${o?"":",null"},${i}`);return s+")"}(e,t);{let n;if(e.component)n=function(e,t,n){const r=t.inlineTemplate?null:bs(t,n,!0);return `_c(${e},${ys(t,n)}${r?`,${r}`:""})`}(e.component,e,t);else {let r;const s=t.maybeComponent(e);let o;(!e.plain||e.pre&&s)&&(r=ys(e,t));const i=t.options.bindings;s&&i&&!1!==i.__isScriptSetup&&(o=function(e,t){const n=x(t),r=w(n),s=s=>e[t]===s?t:e[n]===s?n:e[r]===s?r:void 0,o=s("setup-const")||s("setup-reactive-const");if(o)return o;const i=s("setup-let")||s("setup-ref")||s("setup-maybe-ref");if(i)return i}(i,e.tag)),o||(o=`'${e.tag}'`);const c=e.inlineTemplate?null:bs(e,t,!0);n=`_c(${o}${r?`,${r}`:""}${c?`,${c}`:""})`;}for(let r=0;r<t.transforms.length;r++)n=t.transforms[r](e,n);return n}}return bs(e,t)||"void 0"}function ps(e,t){e.staticProcessed=!0;const n=t.pre;return e.pre&&(t.pre=e.pre),t.staticRenderFns.push(`with(this){return ${fs(e,t)}}`),t.pre=n,`_m(${t.staticRenderFns.length-1}${e.staticInFor?",true":""})`}function ds(e,t){if(e.onceProcessed=!0,e.if&&!e.ifProcessed)return hs(e,t);if(e.staticInFor){let n="",r=e.parent;for(;r;){if(r.for){n=r.key;break}r=r.parent;}return n?`_o(${fs(e,t)},${t.onceId++},${n})`:fs(e,t)}return ps(e,t)}function hs(e,t,n,r){return e.ifProcessed=!0,ms(e.ifConditions.slice(),t,n,r)}function ms(e,t,n,r){if(!e.length)return r||"_e()";const s=e.shift();return s.exp?`(${s.exp})?${o(s.block)}:${ms(e,t,n,r)}`:`${o(s.block)}`;function o(e){return n?n(e,t):e.once?ds(e,t):fs(e,t)}}function gs(e,t,n,r){const s=e.for,o=e.alias,i=e.iterator1?`,${e.iterator1}`:"",c=e.iterator2?`,${e.iterator2}`:"";return e.forProcessed=!0,`${r||"_l"}((${s}),function(${o}${i}${c}){return ${(n||fs)(e,t)}})`}function ys(e,t){let n="{";const r=function(e,t){const n=e.directives;if(!n)return;let r,s,o,i,c="directives:[",a=!1;for(r=0,s=n.length;r<s;r++){o=n[r],i=!0;const s=t.directives[o.name];s&&(i=!!s(e,o,t.warn)),i&&(a=!0,c+=`{name:"${o.name}",rawName:"${o.rawName}"${o.value?`,value:(${o.value}),expression:${JSON.stringify(o.value)}`:""}${o.arg?`,arg:${o.isDynamicArg?o.arg:`"${o.arg}"`}`:""}${o.modifiers?`,modifiers:${JSON.stringify(o.modifiers)}`:""}},`);}if(a)return c.slice(0,-1)+"]"}(e,t);r&&(n+=r+","),e.key&&(n+=`key:${e.key},`),e.ref&&(n+=`ref:${e.ref},`),e.refInFor&&(n+="refInFor:true,"),e.pre&&(n+="pre:true,"),e.component&&(n+=`tag:"${e.tag}",`);for(let r=0;r<t.dataGenFns.length;r++)n+=t.dataGenFns[r](e);if(e.attrs&&(n+=`attrs:${Ss(e.attrs)},`),e.props&&(n+=`domProps:${Ss(e.props)},`),e.events&&(n+=`${is(e.events,!1)},`),e.nativeEvents&&(n+=`${is(e.nativeEvents,!0)},`),e.slotTarget&&!e.slotScope&&(n+=`slot:${e.slotTarget},`),e.scopedSlots&&(n+=`${function(e,t,n){let r=e.for||Object.keys(t).some((e=>{const n=t[e];return n.slotTargetDynamic||n.if||n.for||$s(n)})),s=!!e.if;if(!r){let t=e.parent;for(;t;){if(t.slotScope&&"_empty_"!==t.slotScope||t.for){r=!0;break}t.if&&(s=!0),t=t.parent;}}const o=Object.keys(t).map((e=>vs(t[e],n))).join(",");return `scopedSlots:_u([${o}]${r?",null,true":""}${!r&&s?`,null,false,${function(e){let t=5381,n=e.length;for(;n;)t=33*t^e.charCodeAt(--n);return t>>>0}(o)}`:""})`}(e,e.scopedSlots,t)},`),e.model&&(n+=`model:{value:${e.model.value},callback:${e.model.callback},expression:${e.model.expression}},`),e.inlineTemplate){const r=function(e,t){const n=e.children[0];if(n&&1===n.type){const e=function(e,t){const n=new us(t);return {render:`with(this){return ${e?"script"===e.tag?"null":fs(e,n):'_c("div")'}}`,staticRenderFns:n.staticRenderFns}}(n,t.options);return `inlineTemplate:{render:function(){${e.render}},staticRenderFns:[${e.staticRenderFns.map((e=>`function(){${e}}`)).join(",")}]}`}}(e,t);r&&(n+=`${r},`);}return n=n.replace(/,$/,"")+"}",e.dynamicAttrs&&(n=`_b(${n},"${e.tag}",${Ss(e.dynamicAttrs)})`),e.wrapData&&(n=e.wrapData(n)),e.wrapListeners&&(n=e.wrapListeners(n)),n}function $s(e){return 1===e.type&&("slot"===e.tag||e.children.some($s))}function vs(e,t){const n=e.attrsMap["slot-scope"];if(e.if&&!e.ifProcessed&&!n)return hs(e,t,vs,"null");if(e.for&&!e.forProcessed)return gs(e,t,vs);const r="_empty_"===e.slotScope?"":String(e.slotScope),s=`function(${r}){return ${"template"===e.tag?e.if&&n?`(${e.if})?${bs(e,t)||"undefined"}:undefined`:bs(e,t)||"undefined":fs(e,t)}}`,o=r?"":",proxy:true";return `{key:${e.slotTarget||'"default"'},fn:${s}${o}}`}function bs(e,t,n,r,s){const o=e.children;if(o.length){const e=o[0];if(1===o.length&&e.for&&"template"!==e.tag&&"slot"!==e.tag){const s=n?t.maybeComponent(e)?",1":",0":"";return `${(r||fs)(e,t)}${s}`}const i=n?function(e,t){let n=0;for(let r=0;r<e.length;r++){const s=e[r];if(1===s.type){if(_s(s)||s.ifConditions&&s.ifConditions.some((e=>_s(e.block)))){n=2;break}(t(s)||s.ifConditions&&s.ifConditions.some((e=>t(e.block))))&&(n=1);}}return n}(o,t.maybeComponent):0,c=s||xs;return `[${o.map((e=>c(e,t))).join(",")}]${i?`,${i}`:""}`}}function _s(e){return void 0!==e.for||"template"===e.tag||"slot"===e.tag}function xs(e,t){return 1===e.type?fs(e,t):3===e.type&&e.isComment?function(e){return `_e(${JSON.stringify(e.text)})`}(e):ws(e)}function ws(e){return `_v(${2===e.type?e.expression:ks(JSON.stringify(e.text))})`}function Ss(e){let t="",n="";for(let r=0;r<e.length;r++){const s=e[r],o=ks(s.value);s.dynamic?n+=`${s.name},${o},`:t+=`"${s.name}":${o},`;}return t=`{${t.slice(0,-1)}}`,n?`_d(${t},[${n.slice(0,-1)}])`:t}function ks(e){return e.replace(/\u2028/g,"\\u2028").replace(/\u2029/g,"\\u2029")}const Os=/^"(?:[^"\\]|\\.)*"$|^'(?:[^'\\]|\\.)*'$/;function Cs(e,t){return Os.test(t)?(t=t.replace(/^'|'$/g,'"'),H(e)&&'"false"'!==t&&(t='"true"'),{type:Rs,value:Z(e)?` ${e}="${e}"`:'""'===t?` ${e}`:` ${e}="${JSON.parse(t)}"`}):{type:Ds,value:`_ssrAttr(${JSON.stringify(e)},${t})`}}const Ts=0,As=1,js=2,Fs=3,Ps=4;let Ns;function Es(e,t){e&&(Ns=t.isReservedTag||A,Is(e,!0));}function Is(e,t){if(function(e){if(2===e.type||3===e.type)return !1;return g(e.tag)||!Ns(e.tag)||!!e.component||function(e){return 1===e.type&&"select"===e.tag&&null!=e.directives&&e.directives.some((e=>"model"===e.name))}(e)}(e))return void(e.ssrOptimizability=Ts);const n=t||function(e){return 1===e.type&&e.directives&&e.directives.some((e=>!Ms(e.name)))}(e),r=t=>{t.ssrOptimizability!==As&&(e.ssrOptimizability=n?Ps:js);};if(n&&(e.ssrOptimizability=Fs),1===e.type){for(let t=0,n=e.children.length;t<n;t++){const n=e.children[t];Is(n),r(n);}if(e.ifConditions)for(let n=1,s=e.ifConditions.length;n<s;n++){const s=e.ifConditions[n].block;Is(s,t),r(s);}null==e.ssrOptimizability||!t&&(e.attrsMap["v-html"]||e.attrsMap["v-text"])?e.ssrOptimizability=As:e.children=function(e){const t=e.children,n=[];let r=[];const s=()=>{r.length&&n.push({type:1,parent:e,tag:"template",attrsList:[],attrsMap:{},rawAttrsMap:{},children:r,ssrOptimizability:As}),r=[];};for(let e=0;e<t.length;e++){const o=t[e];o.ssrOptimizability===As?r.push(o):(s(),n.push(o));}return s(),n}(e);}else e.ssrOptimizability=As;}const Ms=m("text,html,show,on,bind,model,pre,cloak,once");const Rs=0,Ds=2;function Ls(e,t){if(e.for&&!e.forProcessed)return gs(e,t,Ls);if(e.if&&!e.ifProcessed)return hs(e,t,Ls);if("template"===e.tag&&!e.slotTarget)return e.ssrOptimizability===As?qs(e,t):Bs(e,t)||"void 0";switch(e.ssrOptimizability){case As:return function(e,t){return `_ssrNode(${Js(e,t)})`}(e,t);case js:return function(e,t){const n=Bs(e,t,!0);return `_ssrNode(${Zs(Hs(e,t))},"</${e.tag}>"${n?`,${n}`:""})`}(e,t);case Fs:return zs(e,t,!0);case Ps:return zs(e,t,!1);default:return fs(e,t)}}function zs(e,t,n){const r=e.plain?void 0:ys(e,t),s=n?`[${qs(e,t)}]`:Bs(e,t,!0);return `_c('${e.tag}'${r?`,${r}`:""}${s?`,${s}`:""})`}function Bs(e,t,n){return bs(e,t,n,Ls,Us)}function Us(e,t){return 1===e.type?Ls(e,t):ws(e)}function qs(e,t){return e.children.length?`_ssrNode(${Zs(Vs(e,t))})`:""}function Js(e,t){return `(${Zs(Ks(e,t))})`}function Ks(e,t){if(e.for&&!e.forProcessed)return e.forProcessed=!0,[{type:Ds,value:gs(e,t,Js,"_ssrList")}];if(e.if&&!e.ifProcessed)return e.ifProcessed=!0,[{type:Ds,value:hs(e,t,Js,'"\x3c!----\x3e"')}];if("template"===e.tag)return Vs(e,t);const n=Hs(e,t),r=Vs(e,t),{isUnaryTag:s}=t.options,o=s&&s(e.tag)?[]:[{type:Rs,value:`</${e.tag}>`}];return n.concat(r,o)}function Hs(e,t){let n;!function(e,t){if(e.directives)for(let n=0;n<e.directives.length;n++){const r=e.directives[n];if("model"===r.name){t.directives.model(e,r,t.warn),"textarea"===e.tag&&e.props&&(e.props=e.props.filter((e=>"value"!==e.name)));break}}}(e,t);const r=[{type:Rs,value:`<${e.tag}`}];var s,o,i,c,a,l;return e.attrs&&r.push.apply(r,e.attrs.map((({name:e,value:t})=>Cs(e,t)))),e.props&&r.push.apply(r,function(e,t){const n=[];return e.forEach((({name:e,value:r})=>{e=D[e]||e.toLowerCase(),!R(e)||t&&t.some((t=>t.name===e))||n.push(Cs(e,r));})),n}(e.props,e.attrs)),(n=e.attrsMap["v-bind"])&&r.push({type:Ds,value:`_ssrAttrs(${n})`}),(n=e.attrsMap["v-bind.prop"])&&r.push({type:Ds,value:`_ssrDOMProps(${n})`}),(e.staticClass||e.classBinding)&&r.push.apply(r,(s=e.staticClass,o=e.classBinding,s&&!o?[{type:Rs,value:` class="${JSON.parse(s)}"`}]:[{type:Ds,value:`_ssrClass(${s||"null"},${o||"null"})`}])),(e.staticStyle||e.styleBinding||e.attrsMap["v-show"])&&r.push.apply(r,(i=e.attrsMap.style,c=e.staticStyle,a=e.styleBinding,l=e.attrsMap["v-show"],!i||a||l?[{type:Ds,value:`_ssrStyle(${c||"null"},${a||"null"}, ${l?`{ display: (${l}) ? '' : 'none' }`:"null"})`}]:[{type:Rs,value:` style=${JSON.stringify(i)}`}])),t.options.scopeId&&r.push({type:Rs,value:` ${t.options.scopeId}`}),r.push({type:Rs,value:">"}),r}function Vs(e,t){let n;return (n=e.attrsMap["v-html"])?[{type:Ds,value:`_s(${n})`}]:(n=e.attrsMap["v-text"])||"textarea"===e.tag&&(n=e.attrsMap["v-model"])?[{type:1,value:`_s(${n})`}]:e.children?function(e,t){const n=[];for(let r=0;r<e.length;r++){const s=e[r];if(1===s.type)n.push.apply(n,Ks(s,t));else if(2===s.type)n.push({type:1,value:s.expression});else if(3===s.type){let e=z(s.text);s.isComment&&(e="\x3c!--"+e+"--\x3e"),n.push({type:Rs,value:e});}}return n}(e.children,t):[]}function Zs(e){const t=[];let n="";const r=()=>{n&&(t.push(JSON.stringify(n)),n="");};for(let s=0;s<e.length;s++){const o=e[s];o.type===Rs?n+=o.value:1===o.type?(r(),t.push(`_ssrEscape(${o.value})`)):o.type===Ds&&(r(),t.push(`(${o.value})`));}return r(),t.join("+")}function Ws(e,t){try{return new Function(e)}catch(n){return t.push({err:n,code:e}),T}}function Gs(e){const t=Object.create(null);return function(n,r,s){(r=O({},r)).warn,delete r.warn;const o=r.delimiters?String(r.delimiters)+n:n;if(t[o])return t[o];const i=e(n,r),c={},a=[];return c.render=Ws(i.render,a),c.staticRenderFns=i.staticRenderFns.map((e=>Ws(e,a))),t[o]=c}}new RegExp("\\b"+"do,if,for,let,new,try,var,case,else,with,await,break,catch,class,const,super,throw,while,yield,delete,export,import,return,switch,default,extends,finally,continue,debugger,function,arguments".split(",").join("\\b|\\b")+"\\b"),new RegExp("\\b"+"delete,typeof,void".split(",").join("\\s*\\([^\\)]*\\)|\\b")+"\\s*\\([^\\)]*\\)");const Qs=(Xs=function(e,t){const n=Br(e.trim(),t);Es(n,t);const r=function(e,t){const n=new us(t);return {render:`with(this){return ${e?Ls(e,n):'_c("div")'}}`,staticRenderFns:n.staticRenderFns}}(n,t);return {ast:n,render:r.render,staticRenderFns:r.staticRenderFns}},function(e){function t(t,n){const r=Object.create(e),s=[],o=[];if(n){n.modules&&(r.modules=(e.modules||[]).concat(n.modules)),n.directives&&(r.directives=O(Object.create(e.directives||null),n.directives));for(const e in n)"modules"!==e&&"directives"!==e&&(r[e]=n[e]);}r.warn=(e,t,n)=>{(n?o:s).push(e);};const i=Xs(t.trim(),r);return i.errors=s,i.tips=o,i}return {compile:t,compileToFunctions:Gs(t)}});var Xs;const{compile:Ys,compileToFunctions:eo}=Qs(Xr),to={_ssrEscape:z,_ssrNode:function(e,t,n,r){return new no(e,t,n,r)},_ssrList:function(e,t){let n,r,s,o,i="";if(Array.isArray(e)||"string"==typeof e)for(n=0,r=e.length;n<r;n++)i+=t(e[n],n);else if("number"==typeof e)for(n=0;n<e;n++)i+=t(n+1,n);else if(u(e))for(s=Object.keys(e),n=0,r=s.length;n<r;n++)o=s[n],i+=t(e[o],o,n);return i},_ssrAttr:G,_ssrAttrs:function(e){let t="";for(const n in e)M(n)||(t+=G(n,e[n]));return t},_ssrDOMProps:function(e){let t="";for(const n in e){const r=D[n]||n.toLowerCase();R(r)&&(t+=G(r,e[n]));}return t},_ssrClass:function(e,t){const n=Xt(e,t);return ""===n?n:` class="${z(n)}"`},_ssrStyle:function(e,t,n){const r={};e&&O(r,e);t&&O(r,on(t));n&&O(r,n);const s=cn(r);return ""===s?s:` style=${JSON.stringify(z(s))}`}};class no{constructor(e,t,n,r){this.isString=!0,this.open=e,this.close=t,this.children=n?1===r?De(n):2===r?Le(n):n:void 0;}}let ro=Object.create(null);const so=e=>{ro[e]||(ro[e]=!0,console.warn(`\n\x1b[31m${e}\x1b[39m\n`));},oo=(e,t)=>{const n=t?undefined(t):"";throw new Error(`\n\x1b[31m${e}${n}\x1b[39m\n`)},io=e=>{const{render:t,template:n,_scopeId:r}=e.$options;if(o(t)){if(!n)throw new Error(`render function or template not defined in component: ${e.$options.name||e.$options._componentTag||"anonymous"}`);{const t=eo(n,{scopeId:r,warn:oo},e);e.$options.render=t.render,e.$options.staticRenderFns=t.staticRenderFns;}}};function co(e,t,n){let r=e.$options.serverPrefetch;if(i(r)){Array.isArray(r)||(r=[r]);try{const s=[];for(let t=0,n=r.length;t<n;t++){const n=r[t].call(e,e);n&&"function"==typeof n.then&&s.push(n);}return void Promise.all(s).then(t).catch(n)}catch(e){n(e);}}t();}function ao(e,t,n){e.isString?function(e,t){const{write:n,next:r}=t;if(o(e.children)||0===e.children.length)n(e.open+(e.close||""),r);else {const s=e.children;t.renderStates.push({type:"Element",children:s,rendered:0,total:s.length,endTag:e.close}),n(e.open,r);}}(e,n):i(e.componentOptions)?uo(e,t,n):i(e.tag)?function(e,t,n){const{write:r,next:s}=n;c(t)&&(e.data||(e.data={}),e.data.attrs||(e.data.attrs={}),e.data.attrs["data-server-rendered"]="true");e.fnOptions&&lo(e.fnOptions,r);const a=function(e,t){let n=`<${e.tag}`;const{directives:r,modules:s}=t;o(e.data)&&ho(e)&&(e.data={});if(i(e.data)){const o=e.data.directives;if(o)for(let n=0;n<o.length;n++){const r=o[n].name;if("show"!==r){const s=Kt(t,"directives",r);s&&s(e,o[n]);}}const c=function(e){let t,n;for(;i(e);)e.data&&e.data.directives&&(n=e.data.directives.find((e=>"show"===e.name)),n&&(t=n)),e=e.parent;return t}(e);c&&r.show(e,c);for(let t=0;t<s.length;t++){const r=s[t](e);r&&(n+=r);}}let c;const a=t.activeInstance;i(a)&&a!==e.context&&i(c=a.$options._scopeId)&&(n+=` ${c}`);if(i(e.fnScopeId))n+=` ${e.fnScopeId}`;else for(;i(e);)i(c=e.context.$options._scopeId)&&(n+=` ${c}`),e=e.parent;return n+">"}(e,n),l=`</${e.tag}>`;if(n.isUnaryTag(e.tag))r(a,s);else if(o(e.children)||0===e.children.length)r(a+l,s);else {const t=e.children;n.renderStates.push({type:"Element",children:t,rendered:0,total:t.length,endTag:l}),r(a,s);}}(e,t,n):c(e.isComment)?i(e.asyncFactory)?function(e,t,n){const r=e.asyncFactory,s=r=>{r.__esModule&&r.default&&(r=r.default);const{data:s,children:o,tag:i}=e.asyncMeta,c=It(r,s,e.asyncMeta.context,o,i);c?c.componentOptions?uo(c,t,n):Array.isArray(c)?(n.renderStates.push({type:"Fragment",children:c,rendered:0,total:c.length}),n.next()):ao(c,t,n):n.write("\x3c!----\x3e",n.next);};if(r.resolved)return void s(r.resolved);const o=n.done;let i;try{i=r(s,o);}catch(e){o(e);}if(i)if("function"==typeof i.then)i.then(s,o).catch(o);else {const e=i.component;e&&"function"==typeof e.then&&e.then(s,o).catch(o);}}(e,t,n):n.write(`\x3c!--${e.text}--\x3e`,n.next):n.write(e.raw?e.text:z(String(e.text)),n.next);}function lo(e,t){const n=e._ssrRegister;return t.caching&&i(n)&&t.componentBuffer[t.componentBuffer.length-1].add(n),n}function uo(e,t,n){const{write:r,next:s,userContext:c}=n,a=e.componentOptions.Ctor,l=a.options.serverCacheKey,u=a.options.name,f=n.cache,p=lo(a.options,r);if(i(l)&&i(f)&&i(u)){const o=l(e.componentOptions.propsData);if(!1===o)return void po(e,t,n);const a=u+"::"+o,{has:f,get:d}=n;i(f)?f(a,(o=>{!0===o&&i(d)?d(a,(e=>{i(p)&&p(c),e.components.forEach((e=>e(c))),r(e.html,s);})):fo(e,t,a,n);})):i(d)&&d(a,(o=>{i(o)?(i(p)&&p(c),o.components.forEach((e=>e(c))),r(o.html,s)):fo(e,t,a,n);}));}else i(l)&&o(f)&&so(`[vue-server-renderer] Component ${a.options.name||"(anonymous)"} implemented serverCacheKey, but no cache was provided to the renderer.`),i(l)&&o(u)&&so('[vue-server-renderer] Components that implement "serverCacheKey" must also define a unique "name" option.'),po(e,t,n);}function fo(e,t,n,r){const s=r.write;s.caching=!0;const o=s.cacheBuffer,i=o.push("")-1,c=s.componentBuffer;c.push(new Set),r.renderStates.push({type:"ComponentWithCache",key:n,buffer:o,bufferIndex:i,componentBuffer:c}),po(e,t,r);}function po(e,t,n){const r=n.activeInstance;e.ssrContext=n.userContext;const s=n.activeInstance=Mt(e,n.activeInstance);io(s);const o=n.done;co(s,(()=>{const o=s._render();o.parent=e,n.renderStates.push({type:"Component",prevActive:r}),ao(o,t,n);}),o);}function ho(e){const t=e.parent;return i(t)&&(i(t.data)||ho(t))}function mo(e,t,n,r){return function(s,o,i,c){ro=Object.create(null);const a=new bn({activeInstance:s,userContext:i,write:o,done:c,renderNode:ao,isUnaryTag:n,modules:e,directives:t,cache:r});!function(e){if(e._ssrNode)return;let t=e.constructor;for(;t.super;)t=t.super;O(t.prototype,to),t.FunctionalRenderContext&&O(t.FunctionalRenderContext.prototype,to);}(s),io(s);co(s,(()=>{ao(s._render(),!0,a);}),c);}}class go extends e.Transform{constructor(e,t,n){super(),this.started=!1,this.renderer=e,this.template=t,this.context=n||{},this.inject=e.inject;}_transform(e,t,n){this.started||(this.emit("beforeStart"),this.start()),this.push(e),n();}start(){if(this.started=!0,this.push(this.template.head(this.context)),this.inject){this.context.head&&this.push(this.context.head);const e=this.renderer.renderResourceHints(this.context);e&&this.push(e);const t=this.renderer.renderStyles(this.context);t&&this.push(t);}this.push(this.template.neck(this.context));}_flush(e){if(this.emit("beforeEnd"),this.inject){const e=this.renderer.renderState(this.context);e&&this.push(e);const t=this.renderer.renderScripts(this.context);t&&this.push(t);}this.push(this.template.tail(this.context)),e();}}const yo=require$$1,$o={escape:/{{([^{][\s\S]+?[^}])}}/g,interpolate:/{{{([\s\S]+?)}}}/g};function vo(e){const t=function(e){const t=new Map;return Object.keys(e.modules).forEach((n=>{t.set(n,function(e,t){const n=[],r=t.modules[e];r&&r.forEach((e=>{const r=t.all[e];r&&(t.async.indexOf(r)>-1||!/\.(js|css)($|\?)/.test(r))&&n.push(r);}));return n}(n,e));})),t}(e);return function(e){const n=new Set;for(let r=0;r<e.length;r++){const s=t.get(e[r]);if(s)for(let e=0;e<s.length;e++)n.add(s[e]);}return Array.from(n)}}const bo=require$$3,_o=require$$1;class xo{constructor(e){this.options=e,this.inject=!1!==e.inject;const{template:t}=e;if(this.parsedTemplate=t?"string"==typeof t?function(e,t="\x3c!--vue-ssr-outlet--\x3e"){if("object"==typeof e)return e;let n=e.indexOf("</head>");const r=e.indexOf(t);if(r<0)throw new Error("Content placeholder not found in template.");return n<0&&(n=e.indexOf("<body>"),n<0&&(n=r)),{head:yo(e.slice(0,n),$o),neck:yo(e.slice(n,r),$o),tail:yo(e.slice(r+t.length),$o)}}(t):t:null,this.serialize=e.serializer||(e=>_o(e,{isJSON:!0})),e.clientManifest){const t=this.clientManifest=e.clientManifest;this.publicPath=""===t.publicPath?"":t.publicPath.replace(/([^\/])$/,"$1/"),this.preloadFiles=(t.initial||[]).map(wo),this.prefetchFiles=(t.async||[]).map(wo),this.mapFiles=vo(t);}}bindRenderFns(e){const t=this;["ResourceHints","State","Scripts","Styles"].forEach((n=>{e[`render${n}`]=t[`render${n}`].bind(t,e);})),e.getPreloadFiles=t.getPreloadFiles.bind(t,e);}render(e,t){const n=this.parsedTemplate;if(!n)throw new Error("render cannot be called without a template.");return t=t||{},"function"==typeof n?n(e,t):this.inject?n.head(t)+(t.head||"")+this.renderResourceHints(t)+this.renderStyles(t)+n.neck(t)+e+this.renderState(t)+this.renderScripts(t)+n.tail(t):n.head(t)+n.neck(t)+e+n.tail(t)}renderStyles(e){const t=this.preloadFiles||[],n=this.getUsedAsyncFiles(e)||[],r=t.concat(n).filter((({file:e})=>(e=>/\.css(\?[^.]+)?$/.test(e))(e)));return (r.length?r.map((({file:e})=>`<link rel="stylesheet" href="${this.publicPath}${e}">`)).join(""):"")+(e.styles||"")}renderResourceHints(e){return this.renderPreloadLinks(e)+this.renderPrefetchLinks(e)}getPreloadFiles(e){const t=this.getUsedAsyncFiles(e);return this.preloadFiles||t?(this.preloadFiles||[]).concat(t||[]):[]}renderPreloadLinks(e){const t=this.getPreloadFiles(e),n=this.options.shouldPreload;return t.length?t.map((({file:e,extension:t,fileWithoutQuery:r,asType:s})=>{let o="";return n||"script"===s||"style"===s?n&&!n(r,s)?"":("font"===s&&(o=` type="font/${t}" crossorigin`),`<link rel="preload" href="${this.publicPath}${e}"${""!==s?` as="${s}"`:""}${o}>`):""})).join(""):""}renderPrefetchLinks(e){const t=this.options.shouldPrefetch;if(this.prefetchFiles){const n=this.getUsedAsyncFiles(e),r=e=>n&&n.some((t=>t.file===e));return this.prefetchFiles.map((({file:e,fileWithoutQuery:n,asType:s})=>t&&!t(n,s)||r(e)?"":`<link rel="prefetch" href="${this.publicPath}${e}">`)).join("")}return ""}renderState(e,t){const{contextKey:n="state",windowKey:r="__INITIAL_STATE__"}=t||{},s=this.serialize(e[n]),o=e.nonce?` nonce="${e.nonce}"`:"";return e[n]?`<script${o}>window.${r}=${s};(function(){var s;(s=document.currentScript||document.scripts[document.scripts.length-1]).parentNode.removeChild(s);}());<\/script>`:""}renderScripts(e){if(this.clientManifest){const t=this.preloadFiles.filter((({file:e})=>q(e))),n=(this.getUsedAsyncFiles(e)||[]).filter((({file:e})=>q(e)));return [t[0]].concat(n,t.slice(1)).map((({file:e})=>`<script src="${this.publicPath}${e}" defer><\/script>`)).join("")}return ""}getUsedAsyncFiles(e){if(!e._mappedFiles&&e._registeredComponents&&this.mapFiles){const t=Array.from(e._registeredComponents);e._mappedFiles=this.mapFiles(t).map(wo);}return e._mappedFiles}createStream(e){if(!this.parsedTemplate)throw new Error("createStream cannot be called without a template.");return new go(this,this.parsedTemplate,e||{})}}function wo(e){const t=e.replace(/\?.*/,""),n=bo.extname(t).slice(1);return {file:e,extension:n,fileWithoutQuery:t,asType:So(n)}}function So(e){return "js"===e?"script":"css"===e?"style":/jpe?g|png|svg|gif|webp|ico/.test(e)?"image":/woff2?|ttf|otf|eot/.test(e)?"font":""}const ko=require$$5,Oo=require$$3,Co=require$$1,To=require$$7;function Ao(e){const t={Buffer:Buffer,console:console,process:process,setTimeout:setTimeout,setInterval:setInterval,setImmediate:setImmediate,clearTimeout:clearTimeout,clearInterval:clearInterval,clearImmediate:clearImmediate,__VUE_SSR_CONTEXT__:e};return t.global=t,t}function jo(e,t,n){const r={},s={};return function o(i,c,a={}){if(a[i])return a[i];const l=function(t){if(r[t])return r[t];const n=e[t],s=To.wrap(n),o=new ko.Script(s,{filename:t,displayErrors:!0});return r[t]=o,o}(i),u={exports:{}};(!1===n?l.runInThisContext():l.runInNewContext(c)).call(u.exports,u.exports,(n=>(n=Oo.posix.join(".",n),e[n]?o(n,c,a):t?commonjsRequire(s[n]||(s[n]=Co.sync(n,{basedir:t}))):commonjsRequire(n))),u);const f=Object.prototype.hasOwnProperty.call(u.exports,"default")?u.exports.default:u.exports;return a[i]=f,f}}function Fo(e){if(p(e)){const t={};for(const n in e)t[n]=Fo(e[n]);return t}return Array.isArray(e)?e.slice():e}function Po(e,t,n,r){const s=jo(t,n,r);if(!1!==r&&"once"!==r)return (t={})=>new Promise((n=>{t._registeredComponents=new Set;const r=s(e,Ao(t));n("function"==typeof r?r(t):r);}));{let t,n;return (o={})=>new Promise((i=>{if(!t){const o="once"===r?Ao():commonjsGlobal;if(n=o.__VUE_SSR_CONTEXT__={},t=s(e,o),delete o.__VUE_SSR_CONTEXT__,"function"!=typeof t)throw new Error("bundle export should be a function when using { runInNewContext: false }.")}if(o._registeredComponents=new Set,n._styles){o._styles=Fo(n._styles);const e=n._renderStyles;e&&Object.defineProperty(o,"styles",{enumerable:!0,get:()=>e(o._styles)});}i(t(o));}))}}const No=require$$1.SourceMapConsumer,Eo=/\(([^)]+\.js):(\d+):(\d+)\)$/;function Io(e,t){e&&"string"==typeof e.stack&&(e.stack=e.stack.split("\n").map((e=>function(e,t){const n=e.match(Eo),r=n&&t[n[1]];if(null!=n&&r){const t=r.originalPositionFor({line:Number(n[2]),column:Number(n[3])});if(null!=t.source){const{source:n,line:r,column:s}=t,o=`(${n.replace(/^webpack:\/\/\//,"")}:${String(r)}:${String(s)})`;return e.replace(Eo,o)}return e}return e}(e,t))).join("\n"));}const Mo=require$$9,Ro=require$$3,Do=require$$0.PassThrough,Lo="Invalid server-rendering bundle format. Should be a string or a bundle Object of type:\n\n{\n  entry: string;\n  files: { [filename: string]: string; };\n  maps: { [filename: string]: string; };\n}\n";function zo(e={}){return function({modules:e=[],directives:t={},isUnaryTag:n=(()=>!1),template:r,inject:s,cache:o,shouldPreload:i,shouldPrefetch:c,clientManifest:a,serializer:l}={}){const u=mo(e,t,n,o),f=new xo({template:r,inject:s,shouldPreload:i,shouldPrefetch:c,clientManifest:a,serializer:l});return {renderToString(e,t,n){let s;"function"==typeof t&&(n=t,t={}),t&&f.bindRenderFns(t),n||({promise:s,cb:n}=J());let o="";const i=$n((e=>(o+=e,!1)),n);try{u(e,i,t,(e=>{if(e)return n(e);if(t&&t.rendered&&t.rendered(t),r)try{const e=f.render(o,t);"string"!=typeof e?e.then((e=>n(null,e))).catch(n):n(null,e);}catch(e){n(e);}else n(null,o);}));}catch(e){n(e);}return s},renderToStream(e,t){t&&f.bindRenderFns(t);const n=new vn(((n,r)=>{u(e,n,t,r);}));if(r){if("function"==typeof r)throw new Error("function template is only supported in renderToString.");{const e=f.createStream(t);if(n.on("error",(t=>{e.emit("error",t);})),n.pipe(e),t&&t.rendered){const e=t.rendered;n.once("beforeEnd",(()=>{e(t);}));}return e}}if(t&&t.rendered){const e=t.rendered;n.once("beforeEnd",(()=>{e(t);}));}return n}}}(O(O({},e),{isUnaryTag:dn,canBeLeftOpenTag:hn,modules:ln,directives:O(pn,e.directives)}))}process.env.VUE_ENV="server";const Bo=function(e){return function(t,n={}){let r,s,o,i=n.basedir;if("string"==typeof t&&/\.js(on)?$/.test(t)&&Ro.isAbsolute(t)){if(!Mo.existsSync(t))throw new Error(`Cannot locate bundle file: ${t}`);{const e=/\.json$/.test(t);if(i=i||Ro.dirname(t),t=Mo.readFileSync(t,"utf-8"),e)try{t=JSON.parse(t);}catch(e){throw new Error(`Invalid JSON bundle file: ${t}`)}}}if("object"==typeof t){if(s=t.entry,r=t.files,i=i||t.basedir,o=function(e){const t={};return Object.keys(e).forEach((n=>{t[n]=new No(e[n]);})),t}(t.maps),"string"!=typeof s||"object"!=typeof r)throw new Error(Lo)}else {if("string"!=typeof t)throw new Error(Lo);s="__vue_ssr_bundle__",r={__vue_ssr_bundle__:t},o={};}const c=e(n),a=Po(s,r,i,n.runInNewContext);return {renderToString:(e,t)=>{let n;return "function"==typeof e&&(t=e,e={}),t||({promise:n,cb:t}=J()),a(e).catch((e=>{Io(e,o),t(e);})).then((n=>{n&&c.renderToString(n,e,((e,n)=>{Io(e,o),t(e,n);}));})),n},renderToStream:e=>{const t=new Do;return a(e).catch((e=>{Io(e,o),process.nextTick((()=>{t.emit("error",e);}));})).then((r=>{if(r){const s=c.renderToStream(r,e);s.on("error",(e=>{Io(e,o),t.emit("error",e);})),n&&n.template&&(s.on("beforeStart",(()=>{t.emit("beforeStart");})),s.on("beforeEnd",(()=>{t.emit("beforeEnd");}))),s.pipe(t);}})),t}}}}(zo);build_prod.createBundleRenderer=Bo,createRenderer = build_prod.createRenderer=zo;

const _renderer = createRenderer({});
const __VUE_SSR_CONTEXT__ = globalThis.__VUE_SSR_CONTEXT__ = {};
function renderToString(component, context) {
  return new Promise((resolve, reject) => {
    _renderer.renderToString(component, context, (err, result) => {
      const styles = [__VUE_SSR_CONTEXT__, context].map((c) => c && c._styles && c._styles.default).filter(Boolean);
      if (!context._styles) {
        context._styles = {};
      }
      context._styles.default = {
        ids: [...styles.map((s) => s.ids)],
        css: styles.map((s) => s.css).join(""),
        media: styles.map((s) => s.media).join("")
      };
      if (err) {
        return reject(err);
      }
      return resolve(result);
    });
  });
}

const STATIC_ASSETS_BASE = process.env.NUXT_STATIC_BASE + "/" + process.env.NUXT_STATIC_VERSION;
const PAYLOAD_JS = "/payload.js";
const getClientManifest = () => import('./client.manifest.mjs').then((r) => r.default || r);
const getServerEntry = () => import('./server.mjs').then((r) => r.default || r);
const getSSRRenderer = lazyCachedFunction(async () => {
  const clientManifest = await getClientManifest();
  if (!clientManifest) {
    throw new Error("client.manifest is not available");
  }
  const createSSRApp = await getServerEntry();
  if (!createSSRApp) {
    throw new Error("Server bundle is not available");
  }
  return createRenderer$1(createSSRApp, {
    clientManifest,
    renderToString,
    publicPath: buildAssetsURL()
  });
});
const getSPARenderer = lazyCachedFunction(async () => {
  const clientManifest = await getClientManifest();
  const renderToString2 = (ssrContext) => {
    const config = useRuntimeConfig();
    ssrContext.nuxt = {
      serverRendered: false,
      config: {
        public: config.public,
        app: config.app
      }
    };
    let entryFiles = Object.values(clientManifest).filter((fileValue) => fileValue.isEntry);
    if ("all" in clientManifest && "initial" in clientManifest) {
      entryFiles = clientManifest.initial.map((file) => ({ file }));
    }
    return Promise.resolve({
      html: '<div id="__nuxt"></div>',
      renderResourceHints: () => "",
      renderStyles: () => entryFiles.flatMap(({ css }) => css).filter((css) => css != null).map((file) => `<link rel="stylesheet" href="${buildAssetsURL(file)}">`).join(""),
      renderScripts: () => entryFiles.map(({ file }) => {
        const isMJS = !file.endsWith(".js");
        return `<script ${isMJS ? 'type="module"' : ""} src="${buildAssetsURL(file)}"><\/script>`;
      }).join("")
    });
  };
  return { renderToString: renderToString2 };
});
const renderer = eventHandler(async (event) => {
  const ssrError = event.req.url?.startsWith("/__nuxt_error") ? useQuery(event) : null;
  let url = ssrError?.url || event.req.url;
  let isPayloadReq = false;
  if (url.startsWith(STATIC_ASSETS_BASE) && url.endsWith(PAYLOAD_JS)) {
    isPayloadReq = true;
    url = url.slice(STATIC_ASSETS_BASE.length, url.length - PAYLOAD_JS.length) || "/";
  }
  const config = useRuntimeConfig();
  const ssrContext = {
    url,
    event,
    req: event.req,
    res: event.res,
    runtimeConfig: { private: config, public: { public: config.public, app: config.app } },
    noSSR: !!event.req.headers["x-nuxt-no-ssr"],
    error: ssrError,
    redirected: void 0,
    nuxt: void 0,
    payload: void 0
  };
  const renderer = ssrContext.noSSR ? await getSPARenderer() : await getSSRRenderer();
  const rendered = await renderer.renderToString(ssrContext).catch((e) => {
    if (!ssrError) {
      throw e;
    }
  });
  if (!rendered) {
    return;
  }
  if (ssrContext.redirected || event.res.writableEnded) {
    return;
  }
  if (ssrContext.nuxt?.error && !ssrError) {
    throw ssrContext.nuxt.error;
  }
  if (ssrContext.nuxt?.hooks) {
    await ssrContext.nuxt.hooks.callHook("app:rendered");
  }
  ssrContext.nuxt = ssrContext.nuxt || {};
  if (process.env.NUXT_FULL_STATIC) {
    ssrContext.nuxt.staticAssetsBase = STATIC_ASSETS_BASE;
  }
  if (isPayloadReq) {
    const data = renderPayload(ssrContext.nuxt, url);
    event.res.setHeader("Content-Type", "text/javascript;charset=UTF-8");
    return data;
  } else {
    const data = await renderHTML(ssrContext.nuxt, rendered, ssrContext);
    event.res.setHeader("Content-Type", "text/html;charset=UTF-8");
    return data;
  }
});
async function renderHTML(payload, rendered, ssrContext) {
  const state = `<script>window.__NUXT__=${devalue(payload)}<\/script>`;
  rendered.meta = rendered.meta || {};
  if (ssrContext.renderMeta) {
    Object.assign(rendered.meta, await ssrContext.renderMeta());
  }
  return htmlTemplate({
    HTML_ATTRS: rendered.meta.htmlAttrs || "",
    HEAD_ATTRS: rendered.meta.headAttrs || "",
    HEAD: (rendered.meta.headTags || "") + rendered.renderResourceHints() + rendered.renderStyles() + (ssrContext.styles || ""),
    BODY_ATTRS: rendered.meta.bodyAttrs || "",
    BODY_PREPEND: ssrContext.teleports?.body || "",
    APP: (rendered.meta.bodyScriptsPrepend || "") + rendered.html + state + rendered.renderScripts() + (rendered.meta.bodyScripts || "")
  });
}
function renderPayload(payload, url) {
  return `__NUXT_JSONP__("${url}", ${devalue(payload)})`;
}
function lazyCachedFunction(fn) {
  let res = null;
  return () => {
    if (res === null) {
      res = fn().catch((err) => {
        res = null;
        throw err;
      });
    }
    return res;
  };
}

const renderer$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': renderer
});

export { getDefaultExportFromCjs as a, commonjsGlobal as c, getDefaultExportFromNamespaceIfNotNamed as g, renderer$1 as r };
//# sourceMappingURL=renderer.mjs.map
