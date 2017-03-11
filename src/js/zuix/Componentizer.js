/**
 * Copyright 2015-2017 G-Labs. All Rights Reserved.
 *         https://genielabs.github.io/zuix
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 *
 *  This file is part of
 *  ZUIX, Javascript library for component-based development.
 *        https://genielabs.github.io/zuix
 *
 * @author Generoso Martello <generoso@martello.com>
 */

"use strict";


/**
 *
 * @param {Element|ZxQuery|undefined} [element] Scan and process loadable elements inside `element`.
 * @param {Element|undefined} [child] Process only the specified `child` of `element`.
 * @return {Componentizer}
 */
Componentizer.prototype.componentize = function (element, child) {
    zuix.trigger(this, 'componentize:begin');
    if (child != null) {
        var cache = getElementCache(element);
        if (cache == null)
            setElementCache(element, [child]);
        else cache.push(child);
    } else {
        addRequest(element);
    }
    loadNext(element);
    return this;
};

/**
 *
 * @return {boolean}
 */
Componentizer.prototype.willLoadMore = function () {
    return _componentizeQueue.length > 0 || _componentizeRequests.length > 0;
};

/**
 * Enable/Disable lazy-loading, or get current value.
 *
 * @param {boolean} [enable]
 * @return {boolean} *true* if lazy-loading is enabled, *false* otherwise.
 */
Componentizer.prototype.lazyLoad = function (enable) {
    return lazyLoad(enable);
};

/**
 *
 * @param {Zuix} zuixInstance
 * @return {Componentizer}
 */
Componentizer.prototype.setHost = function (zuixInstance) {
    zuix = zuixInstance;
    return this;
};

module.exports = function () {
    return new Componentizer();
};


// ---------------------------------------------


var _log =
    require('../helpers/Logger')('ComponentContext.js');
var util =
    require('../helpers/Util');
var z$ =
    require('../helpers/ZxQuery');

/** @type {Zuix} **/
var zuix = null;

/** @private */
var _componentizeRequests = [];
/** @private */
var _componentizeQueue = [],
    /** @private */
    _disableLazyLoading = false,
    /** @private */
    _lazyElements = [],
    _lazyContainers = [];

// Browser Agent / Bot detection
/** @private */
var _isCrawlerBotClient = false;
if (navigator && navigator.userAgent)
    _isCrawlerBotClient = new RegExp(/bot|googlebot|crawler|spider|robot|crawling/i)
        .test(navigator.userAgent);
if (_isCrawlerBotClient)
    _log.d(navigator.userAgent, "is a bot, ignoring `lazy-loading` option.");

/** @private */
var TaskItem = function () {
    return {
        /** @typedef {Element} */
        element: null,
        /** @typedef {number} */
        priority: 0,
        /** @typedef {boolean} */
        visible: true,
        /** @typedef {boolean} */
        lazy: false
    }
};


// Components Loading Chain
var loader = require('./../helpers/AsynChain')({

    doWork: function (item, callback) {
        z$(item.element).one('component:ready', function () {
            callback();
        });
        return loadInline(item.element);
    },
    willBreak: function () {
        return false;
    },
    status: function (status) {
        switch (status) {
            case 'start':
                break;
            case 'done':
                loadNext();
                break;
        }
    }

});

function Componentizer() {
    // ...
}

function lazyLoad(enable) {
    if (enable != null)
        _disableLazyLoading = !enable;
    return !_isCrawlerBotClient && !_disableLazyLoading;
}

function addRequest(element) {
    if (element == null)
        element = document;
    if (!_componentizeRequests.indexOf(element))
        _componentizeRequests.push(element);
}

var _elementCache = [];
function setElementCache(element, waiting) {
    _elementCache.push({
        element: element,
        waiting: waiting
    });
}
function getElementCache(element) {
    for (var i = 0; i < _elementCache.length; i++) {
        var cache = _elementCache[i];
        if (cache.element === element)
            return cache.waiting;
    }
    return null;
}

function queueLoadables(element) {

    if (element == null && _componentizeRequests.length > 0)
        element = _componentizeRequests.unshift();

    if (element instanceof z$.ZxQuery)
        element = element.get();

    // Select all loadable elements
    var waitingLoad = getElementCache(element);
//    if (waitingLoad == null || waitingLoad.length == 0) {
    waitingLoad = z$(element).find('[data-ui-load]:not([data-ui-loaded=true]),[data-ui-include]:not([data-ui-loaded=true])');
    waitingLoad = Array.prototype.slice.call(waitingLoad._selection);
    setElementCache(element, waitingLoad);
//    }
    var waitingTasks = [];
    for (var w = 0; w < waitingLoad.length; w++) {
        var pri = parseInt(waitingLoad[w].getAttribute('data-ui-priority'));
        if (isNaN(pri)) pri = 0;
        var task = new TaskItem();
        task.element = waitingLoad[w];
        task.priority = pri; //w - ( 12 * ( w % 2 ) ) + ( pri * 73 ); // fuzzy pri
        waitingTasks.push(task);
    }
    var added = 0;
    // add selected elements to the requests queue
    for (var i = 0; i < waitingTasks.length; i++) {
        var alreadyAdded = false;
        for (var j = 0; j < _componentizeQueue.length; j++) {
            if (waitingTasks[i].element === _componentizeQueue[j].element) {
                alreadyAdded = true;
                break;
            }
        }
        if (!alreadyAdded) {
            _componentizeQueue.push(waitingTasks[i]);
            added++;
        }
    }

    _log.t('componentize:count', _componentizeQueue.length, added);

    if (added == 0 || (_componentizeRequests.length == 0 && _componentizeQueue.length == 0))
        zuix.trigger(this, 'componentize:end');
}

function getNextLoadable() {

    // sort by priority (elements with lower pri number get processed first)
    _componentizeQueue.sort(function (a, b) {
        return a.priority - b.priority;
    });
    var job = null, reinsert = [];
    var item = _componentizeQueue.length > 0 ? _componentizeQueue.shift() : null;
    while (item != null && item.element != null) {
        // defer element loading if lazy loading is enabled and the element is not in view
        var ls = lazyScrollCheck(item.element);
        if (lazyLoad() && ls.scroller !== false && item.element.getAttribute('data-ui-lazyload') != 'false') {
            item.lazy = true;
            item.visible = z$.getPosition(item.element).visible;
        } else {
            item.lazy = false;
            item.visible = true;
        }
        // ...
        if (item.element != null && item.element.getAttribute('data-ui-loaded') == 'true' || !item.visible) {
            if (!item.visible) reinsert.push(item);
            item = null;
        } else if (item != null && item.element != null && item.visible) {
            job = {
                item: item,
                cancelable: item.lazy
            };
            break;
        }
        if (_componentizeQueue.length > 0)
            item = _componentizeQueue.shift();
        else break;
    }
    Array.prototype.push.apply(_componentizeQueue, reinsert);
    return job;
}

function loadNext(element) {
    queueLoadables(element);
    var job = getNextLoadable();
    if (job != null)
        loader.append([job]);
}

/** @protected */
function loadInline(element) {

    var v = z$(element);
    if (v.attr('data-ui-loaded') === 'true' || v.parent('pre,code').length() > 0) {
        //_log.w("Skipped", element);
        return false;
    } else v.attr('data-ui-loaded', 'true');

    /** @type {ContextOptions} */
    var options = v.attr('data-ui-options');
    if (!util.isNoU(options)) {
        options = util.propertyFromPath(window, options);
        // copy passed options
        options = util.cloneObject(options) || {};
    } else options = {};

    // Automatic view/container selection
    if (util.isNoU(options.view) && !v.isEmpty()) {
        options.view = element;
        options.viewDeferred = true;
    } else if (util.isNoU(options.view) && util.isNoU(options.container) && v.isEmpty())
        options.container = element;

    var componentId = v.attr('data-ui-load');
    if (util.isNoU(componentId)) {
        // Static include should not have any controller
        componentId = v.attr('data-ui-include');
        v.attr('data-ui-component', componentId);
        // disable controller auto-loading
        if (util.isNoU(options.controller))
            options.controller = function () {
            }; // null
    }

    // inline attributes have precedence over ```options```

    var model = v.attr('data-bind-model');
    if (!util.isNoU(model) && model.length > 0)
        options.model = util.propertyFromPath(window, model);

    var contextId = v.attr('data-ui-context');
    if (!util.isNoU(contextId))
        options.contextId = contextId;

    var priority = parseInt(v.attr('data-ui-priority'));
    if (!util.isNoU(priority))
        options.priority = priority;

    var el = z$(element);
    el.one('component:ready', function () {
        addRequest(element);
        loadNext(element);
    });

    zuix.load(componentId, options);

    return true;
}


// ------------ Lazy Loading

function getLazyElement(el) {
    for (var l = 0; l < _lazyElements.length; l++) {
        var le = _lazyElements[l];
        if (le.element === el)
            return le;
    }
    return null;
}

function addLazyElement(el) {
    var le = {
        element: el,
        scroller: false
    };
    _lazyElements.push(le);
    return le;
}

function getLazyContainer(el) {
    for (var l = 0; l < _lazyContainers.length; l++) {
        var ls = _lazyContainers[l];
        if (ls.element === el)
            return ls;
    }
    return null;
}

function addLazyContainer(el) {
    var lc = {
        element: el,
        handler: false
    };
    _lazyContainers.push(lc);
    return lc;
}

function lazyScrollCheck(el) {
    // store a reference to its scroller container for lazy-loaded elements
    var ls = getLazyElement(el);
    if (ls == null) {
        ls = addLazyElement(el);
        var lazyContainer = z$.getClosest(el, '[data-ui-lazyload=scroll]');
        // override lazy loading if 'lazyload' is set to 'false' for the current element
        if (lazyContainer != null) {
            var lc = getLazyContainer(lazyContainer);
            if (lc == null) {
                lc = addLazyContainer(lazyContainer);
                // attach 'scroll' event handler to lazy-scroller
                var scrollWatcher = function (instance, lc) {
                    var lastScroll = new Date().getTime();
                    z$(lc).on('scroll', function () {
                        var now = new Date().getTime();
                        if (now - lastScroll > 100) {
                            lastScroll = now;
                            loadNext(lc);
                        }
                    });
                }(this, lazyContainer);
            }
            ls.scroller = (lc == null ? false : lc);
        }
    }
    return ls;
}
