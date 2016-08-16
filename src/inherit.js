import clone from './clone';

const debug = require('debug')('postcss-inherit');

function isAtruleDescendant(node) {
  let { parent } = node;
  let descended = false;

  while (parent && parent.type !== 'root') {
    if (parent.type === 'atrule') {
      descended = parent.params;
    }
    parent = parent.parent;
  }
  return descended;
}
function isPlaceholder(val) {
  return val[0] === '%';
}
function escapeRegExp(str) {
  return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, '\\$&');
}

function matchRegExp(val) {
  const expression = `${escapeRegExp(val)}((?:$|\\s|\\>|\\+|~|\\:|\\[)?)`;
  let expressionPrefix = '(^|\\s|\\>|\\+|~)';
  if (isPlaceholder(val)) {
    // We just want to match an empty group here to preserve the arguments we
    // may be expecting in a RegExp match.
    expressionPrefix = '()';
  }
  return new RegExp(expressionPrefix + expression, 'g');
}
function replaceRegExp(val) {
  const operatorRegex = /($|::?|\[)/g;
  const newVal = (val.match(operatorRegex)) ? val.substring(0, val.search(operatorRegex)) : val;
  return matchRegExp(newVal);
}
function replaceSelector(matchedSelector, val, selector) {
  return matchedSelector.replace(replaceRegExp(val), (_, first, last) =>
    first + selector + last
  );
}
function makePlaceholder(selector, value) {
  return selector.replace(replaceRegExp(value), (_, first, last) =>
    `%${_}${first}${last}`
  );
}
function parseSelectors(selector) {
  return selector.split(',').map(x => x.trim());
}
function assembleSelectors(selectors) {
  return selectors.join(',\n');
}
function mediaMatch(object, key, value) {
  if (!{}.hasOwnProperty.call(object, key)) {
    return false;
  }
  return ~object[key].indexOf(value);
}
function removeParentsIfEmpty(node) {
  let currentNode = node.parent;
  node.remove();
  while (!currentNode.nodes.length) {
    const parent = currentNode.parent;
    currentNode.remove();
    currentNode = parent;
  }
}
export default class Inherit {
  constructor(css, opts = {}) {
    this.root = css;
    this.matches = {};
    this.propertyRegExp = opts.propertyRegExp || /^(inherit|extend)s?$/i;
    this.root.walkAtRules(atRule => {
      this.atRuleInheritsFromRoot(atRule);
    });
    this.root.walkDecls(decl => {
      if (this.propertyRegExp.test(decl.prop)) {
        const rule = decl.parent;
        parseSelectors(decl.value).forEach(value => {
          this.inheritRule(value, rule, decl);
        });
        removeParentsIfEmpty(decl);
      }
    });
    this.removePlaceholders();
  }
  atRuleInheritsFromRoot(atRule) {
    atRule.walkDecls(decl => {
      if (this.propertyRegExp.test(decl.prop)) {
        const originRule = decl.parent;
        const originAtParams = isAtruleDescendant(originRule);
        const newValueArray = [];
        parseSelectors(decl.value).forEach(value => {
          const targetSelector = value;
          let newValue = value;
          this.root.walkRules(rule => {
            if (!matchRegExp(targetSelector).test(rule.selector)) return;
            const targetAtParams = isAtruleDescendant(rule);
            if (!targetAtParams) {
              newValue = `%${value}`;
            } else {
              return;
            }
            if (!mediaMatch(this.matches, originAtParams, targetSelector)) {
              const newRule = this.copyRule(originRule, rule);
              newRule.selector = makePlaceholder(newRule.selector, targetSelector);
              this.matches[originAtParams] = this.matches[originAtParams] || [];
              this.matches[originAtParams].push(targetSelector);
              this.matches[originAtParams] = [...new Set(this.matches[originAtParams])];
            }
          });
          newValueArray.push(newValue);
        });
        decl.value = newValueArray.join(', ');
      }
    });
  }
  inheritRule(value, originRule, decl) {
    const originSelector = originRule.selector;
    const originAtParams = originRule.atParams || isAtruleDescendant(originRule);
    const targetSelector = value;
    let matched = false;
    let differentLevelMatched = false;
    this.root.walkRules(rule => {
      if (!matchRegExp(targetSelector).test(rule.selector)) return;
      const targetRule = rule;
      const targetAtParams = targetRule.atParams || isAtruleDescendant(targetRule);
      if (targetAtParams === originAtParams) {
        debug('extend %j with %j', originSelector, targetSelector);
        this.appendSelector(originSelector, targetRule, targetSelector);
        matched = true;
      } else {
        differentLevelMatched = true;
      }
    });
    if (!matched) {
      if (differentLevelMatched) {
        throw decl.error(`Could not find rule that matched ${value} in the same atRule.`);
      } else {
        throw decl.error(`Could not find rule that matched ${value}.`);
      }
    }
  }
  appendSelector(originSelector, targetRule, value) {
    const originSelectors = parseSelectors(originSelector);
    let targetRuleSelectors = parseSelectors(targetRule.selector);
    targetRuleSelectors.forEach(targetRuleSelector => {
      [].push.apply(targetRuleSelectors, originSelectors.map(newOriginSelector =>
        replaceSelector(targetRuleSelector, value, newOriginSelector)
      ));
    });
    // removes duplicate selectors
    targetRuleSelectors = [...new Set(targetRuleSelectors)];
    targetRule.selector = assembleSelectors(targetRuleSelectors);
  }
  copyRule(originRule, targetRule) {
    const newRule = clone(targetRule);
    newRule.moveBefore(originRule);
    return newRule;
  }
  removePlaceholders() {
    this.root.walkRules(/%/, rule => {
      const selectors = parseSelectors(rule.selector);
      const newSelectors = selectors.filter(selector =>
        (!~selector.indexOf('%'))
      );
      if (!newSelectors.length) {
        rule.remove();
      } else {
        rule.selector = assembleSelectors(newSelectors);
      }
    });
  }
}
