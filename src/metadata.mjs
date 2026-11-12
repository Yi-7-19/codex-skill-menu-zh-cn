import { isDeepStrictEqual } from 'node:util';
import { isMap, isScalar, parseDocument } from 'yaml';

const SHORT_DESCRIPTION = 'short_description';
const bom = '\uFEFF';

function mapping(source, fileType) {
  if (fileType === 'json') JSON.parse(source);
  const document = parseDocument(source, { keepSourceTokens: true });
  if (document.errors.length || document.warnings.length) {
    throw new Error('元数据语法无效或使用了不支持的 YAML 标签。');
  }
  const empty = isScalar(document.contents) && document.contents.value === null &&
    document.contents.range[0] === document.contents.range[1];
  const root = empty ? null : document.contents;
  if (root !== null && !isMap(root)) {
    throw new Error('元数据根节点须为映射。');
  }
  const data = document.toJS({ maxAliasCount: 30 }) ?? {};
  return { root, data };
}

export function readSkill(markdown) {
  const match = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)^---[ \t]*\r?$/m.exec(markdown);
  if (!match || match.index !== 0) throw new Error('SKILL.md 缺少 YAML 元数据。');
  const { data } = mapping(match[1], 'yaml');
  const { name, description, metadata } = data;
  if (typeof name !== 'string' || !name.trim() || typeof description !== 'string' || !description.trim()) {
    throw new Error('SKILL.md 的 name 和 description 须为非空字符串。');
  }
  return { name, description: text(metadata?.['short-description']) || description.trim() };
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function readMetadata(source, fileType) {
  const body = source.startsWith(bom) ? source.slice(1) : source;
  const { root, data } = mapping(body, fileType);
  const ui = root?.get('interface', true);
  if (ui && !isMap(ui) && !(isScalar(ui) && ui.value === null)) {
    throw new Error('interface 须为映射或空值。');
  }
  const short = isMap(ui) ? ui.get(SHORT_DESCRIPTION, true) : undefined;
  if (short && (!isScalar(short) || (short.value !== null && typeof short.value !== 'string'))) {
    throw new Error('interface.short_description 须为字符串或空值。');
  }
  return { body, root, ui, short, data, description: text(short?.value) };
}

function splice(source, start, end, value) {
  return source.slice(0, start) + value + source.slice(end);
}

function replaceScalar(body, scalar, value) {
  const [start, end] = scalar.range;
  if (start === end) {
    const before = body[start - 1] === ' ' ? '' : ' ';
    const after = body[start] === '#' ? ' ' : '';
    return splice(body, start, end, before + value + after);
  }
  if (scalar.type === 'BLOCK_LITERAL' || scalar.type === 'BLOCK_FOLDED') {
    const token = scalar.srcToken;
    const headerComment = token.props.find(part => part.type === 'comment');
    const newline = token.props.find(part => part.type === 'newline')?.source ?? '';
    return splice(body, start, end, value + (headerComment ? ' ' + headerComment.source : '') + newline);
  }
  return splice(body, start, end, value);
}

function addField(body, parent, key, value, indentValue, newline) {
  if (parent.flow) {
    const first = parent.items[0]?.key?.range[0] ?? parent.range[1] - 1;
    const comma = parent.items.length ? ', ' : '';
    return splice(body, first, first, JSON.stringify(key) + ': ' + value + comma);
  }
  const first = parent.items[0]?.key?.range[0];
  if (first === undefined) throw new Error('无法定位 YAML 字段的插入位置。');
  const start = body.lastIndexOf('\n', first - 1) + 1;
  const indent = body.slice(start, first);
  if (!/^ *$/.test(indent)) throw new Error('无法保留 YAML 中已有字段的排版。');
  const field = indentValue ? key + ':' + newline + indent + '  ' + indentValue : key + ': ' + value;
  return splice(body, start, start, indent + field + newline);
}

function withoutShortDescription(data) {
  const { interface: ui, ...rest } = data;
  if (!ui) return rest;
  const { short_description, ...remaining } = ui;
  return Object.keys(remaining).length ? { ...rest, interface: remaining } : rest;
}

export function setMenuDescription(source, fileType, description) {
  const metadata = readMetadata(source, fileType);
  const { body, root, ui, short, data } = metadata;
  const newline = body.match(/\r?\n/)?.[0] ?? '\n';
  const quoted = JSON.stringify(description);
  const field = SHORT_DESCRIPTION + ': ' + quoted;
  const interfaceValue = '{' + JSON.stringify(SHORT_DESCRIPTION) + ': ' + quoted + '}';
  let updated;
  if (short) {
    updated = replaceScalar(body, short, quoted);
  } else if (isMap(ui)) {
    updated = addField(body, ui, SHORT_DESCRIPTION, quoted, null, newline);
  } else if (ui) {
    updated = replaceScalar(body, ui, interfaceValue);
  } else if (root) {
    updated = addField(body, root, 'interface', interfaceValue, field, newline);
  } else {
    const endMarker = /^\.\.\.[ \t]*(?:#.*)?\r?$/m.exec(body);
    const position = endMarker?.index ?? body.length;
    const prefix = position && body[position - 1] !== '\n' ? newline : '';
    updated = splice(body, position, position, prefix + 'interface:' + newline + '  ' + field + newline);
  }
  if (source.startsWith(bom)) updated = bom + updated;
  const verified = readMetadata(updated, fileType);
  if (verified.description !== description ||
      !isDeepStrictEqual(withoutShortDescription(data), withoutShortDescription(verified.data))) {
    throw new Error('更新会影响菜单说明以外的元数据。');
  }
  return updated;
}
