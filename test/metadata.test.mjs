import assert from 'node:assert/strict';
import test from 'node:test';
import { readMetadata, readSkill, setMenuDescription } from '../src/metadata.mjs';

const label = '生成或编辑图片';

test('replaces the YAML short description and preserves BOM, comments, and mixed line endings', () => {
  const source = '\uFEFFinterface:\r\n  display_name: "Image Gen"\n  short_description: "Make images" # label\r\n' +
    '  default_prompt: "Use $imagegen"\r\npolicy:\r\n  allow_implicit_invocation: false\r\n';
  assert.equal(setMenuDescription(source, 'yaml', label), source.replace('"Make images"', JSON.stringify(label)));
});

test('replaces a folded YAML scalar, including its value lines, and preserves the header comment', () => {
  const source = 'interface:\r\n  short_description: >- # Keep\r\n    Generate\r\n    images\r\n  display_name: Image Gen\r\n';
  assert.equal(setMenuDescription(source, 'yaml', label),
    'interface:\r\n  short_description: "生成或编辑图片" # Keep\r\n  display_name: Image Gen\r\n');
});

test('adds YAML descriptions to an existing interface, an empty value, and a new metadata file', () => {
  const cases = [
    'interface:\n  display_name: Image Gen\n',
    'interface: {display_name: Image Gen,}\n',
    'interface: null\n',
    'interface:\n  short_description: # Keep this comment\n  display_name: Image Gen\n',
    '# Keep\npolicy:\n  allow_implicit_invocation: false\n',
    '---\n...\n',
    '',
  ];
  for (const source of cases) {
    const updated = setMenuDescription(source, 'yaml', label);
    const { description } = readMetadata(updated, 'yaml');
    assert.equal(description, label);
    if (source.includes('# Keep')) assert.match(updated, /# Keep/);
    if (source.includes('display_name')) assert.equal(readMetadata(updated, 'yaml').data.interface.display_name, 'Image Gen');
  }
});

test('preserves JSON formatting and existing interface values', () => {
  const source = '{\n  "interface": { "display_name": "Image Gen", "short_description": "Make images" },\n  "policy": { "allow_implicit_invocation": false }\n}\n';
  assert.equal(setMenuDescription(source, 'json', label), source.replace('"Make images"', JSON.stringify(label)));
  const created = setMenuDescription('{"policy":{"allow_implicit_invocation":false}}', 'json', label);
  assert.deepEqual(JSON.parse(created), { interface: { short_description: label }, policy: { allow_implicit_invocation: false } });
});

test('skips malformed metadata, duplicates, and changes that would alter aliases', () => {
  assert.throws(() => setMenuDescription('interface: []\n', 'yaml', label), /interface/);
  assert.throws(() => setMenuDescription('{"interface": {}, "interface": {}}', 'json', label), /语法/);
  assert.throws(() => setMenuDescription('interface:\n  short_description: &shared Make images\n  display_name: *shared\n', 'yaml', label), /影响/);
});

test('reads the legacy frontmatter short description ahead of the trigger description', () => {
  const skill = '\uFEFF---\r\nname: ImageGen\r\ndescription: >-\r\n  Trigger description\r\nmetadata:\r\n  short-description: Make images\r\n---\r\nSkill body\r\n';
  assert.deepEqual(readSkill(skill), { name: 'ImageGen', description: 'Make images' });
});
