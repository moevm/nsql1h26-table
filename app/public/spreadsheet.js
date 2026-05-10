(function () {
  'use strict';

  const COLLECTIONS = ['users', 'tables', 'forms', 'responses', 'tableLogs', 'formLogs'];
  const SYSTEM_SHEET_NAME = '_AppData';
  const PAYLOAD_CHUNK_SIZE = 28000;
  const MAX_UNZIPPED_BYTES = 25 * 1024 * 1024;
  const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const ODS_TYPE = 'application/vnd.oasis.opendocument.spreadsheet';
  const FORM_FIELD_TYPES = {
    text: 'Краткий ответ',
    textarea: 'Развёрнутый ответ',
    number: 'Число',
    email: 'Email',
    date: 'Дата',
    radio: 'Один из списка',
    checkbox: 'Несколько из списка',
    select: 'Выпадающий список',
    scale: 'Шкала'
  };

  function zipLib() {
    if (!window.fflate || !window.fflate.zipSync || !window.fflate.unzipSync) {
      throw new Error('Модуль работы с XLSX/ODS не загружен.');
    }
    return window.fflate;
  }

  function assertZipBudget(zip) {
    const total = Object.values(zip || {}).reduce((sum, entry) => sum + (entry?.length || 0), 0);
    if (total > MAX_UNZIPPED_BYTES) {
      throw new Error('Spreadsheet-файл слишком большой после распаковки.');
    }
  }

  function emptyData() {
    return Object.fromEntries(COLLECTIONS.map(collection => [collection, []]));
  }

  function escapeXml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function columnName(index) {
    let n = index + 1;
    let name = '';
    while (n > 0) {
      const rem = (n - 1) % 26;
      name = String.fromCharCode(65 + rem) + name;
      n = Math.floor((n - 1) / 26);
    }
    return name;
  }

  function columnIndex(ref) {
    const letters = String(ref || '').match(/[A-Z]+/i)?.[0] || 'A';
    return letters.toUpperCase().split('').reduce((acc, char) => acc * 26 + char.charCodeAt(0) - 64, 0) - 1;
  }

  function sheetName(raw, used, fallback) {
    const cleaned = String(raw || fallback || 'Лист')
      .replace(/[\[\]:*?/\\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || fallback || 'Лист';
    const base = cleaned.slice(0, 31);
    let candidate = base;
    let counter = 2;
    while (used.has(candidate.toLowerCase())) {
      const suffix = ' (' + counter + ')';
      candidate = base.slice(0, 31 - suffix.length) + suffix;
      counter += 1;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  }

  function normalizeRows(rows) {
    return (Array.isArray(rows) ? rows : []).map(row =>
      (Array.isArray(row) ? row : []).map(cell => String(cell ?? ''))
    );
  }

  function trimRows(rows) {
    const normalized = normalizeRows(rows);
    let lastRow = -1;
    let lastCol = -1;

    normalized.forEach((row, rowIndex) => {
      row.forEach((cell, colIndex) => {
        if (String(cell ?? '').trim() !== '') {
          lastRow = Math.max(lastRow, rowIndex);
          lastCol = Math.max(lastCol, colIndex);
        }
      });
    });

    if (lastRow < 0 || lastCol < 0) return [['']];

    return normalized.slice(0, lastRow + 1).map(row => {
      const out = [];
      for (let col = 0; col <= lastCol; col += 1) out.push(row[col] || '');
      return out;
    });
  }

  function valueForCell(value) {
    if (Array.isArray(value)) return value.join(', ');
    return String(value ?? '');
  }

  function safeSpreadsheetText(value) {
    const text = valueForCell(value);
    if (/^[=+@]/.test(text) || /^-[^\d.,]/.test(text) || /^[\t\r\n]/.test(text)) {
      return "'" + text;
    }
    return text;
  }

  function isNumericCell(value) {
    const text = String(value ?? '').trim();
    if (!/^-?\d+(?:[.,]\d+)?$/.test(text)) return false;
    if (/^-?0\d+/.test(text)) return false;
    return Number.isFinite(Number(text.replace(',', '.')));
  }

  function encodePayload(text) {
    const bytes = new TextEncoder().encode(String(text ?? ''));
    return 'hex:' + Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function decodePayload(text) {
    const source = String(text ?? '');
    if (!source.startsWith('hex:')) return source;
    const hex = source.slice(4);
    if (!/^(?:[0-9a-f]{2})*$/i.test(hex)) throw new Error('Некорректный payload внутри spreadsheet-файла.');
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
    return new TextDecoder().decode(bytes);
  }

  function chunkText(text) {
    const source = String(text ?? '');
    const chunks = [];
    for (let i = 0; i < source.length; i += PAYLOAD_CHUNK_SIZE) {
      chunks.push(source.slice(i, i + PAYLOAD_CHUNK_SIZE));
    }
    return chunks.length ? chunks : [''];
  }

  function rowsFromData(data) {
    const rows = [['COLLECTION', 'ITEM_INDEX', 'PART_INDEX', 'PARTS', 'PAYLOAD']];
    COLLECTIONS.forEach(collection => {
      const items = Array.isArray(data?.[collection]) ? data[collection] : [];
      items.forEach((item, itemIndex) => {
        const chunks = chunkText(encodePayload(JSON.stringify(item)));
        chunks.forEach((part, partIndex) => {
          rows.push([collection, String(itemIndex), String(partIndex), String(chunks.length), part]);
        });
      });
    });
    return rows;
  }

  function parseRowsToData(rows) {
    const data = emptyData();
    const normalizedRows = normalizeRows(rows)
      .filter(row => row.some(cell => cell.trim() !== ''));

    if (!normalizedRows.length) return data;

    const firstRow = normalizedRows[0].map(cell => cell.trim().toLowerCase());
    const startIndex = firstRow.includes('collection') && firstRow.includes('payload') ? 1 : 0;
    const entries = [];
    const grouped = new Map();

    normalizedRows.slice(startIndex).forEach((row, rowIndex) => {
      const collection = row[0]?.trim();
      if (!COLLECTIONS.includes(collection)) return;

      const itemIndex = Number(row[1]);
      const partIndex = Number(row[2]);
      const partCount = Number(row[3]);

      if (Number.isInteger(itemIndex) && Number.isInteger(partIndex) && Number.isInteger(partCount) && partCount > 0) {
        const key = collection + ':' + itemIndex;
        if (!grouped.has(key)) {
          grouped.set(key, {
            collection,
            order: rowIndex,
            parts: new Array(partCount).fill('')
          });
        }
        grouped.get(key).parts[partIndex] = row[4] || '';
        return;
      }

      const payload = row.slice(1).join('');
      if (payload.trim()) entries.push({ collection, payload, order: rowIndex });
    });

    grouped.forEach(group => {
      entries.push({
        collection: group.collection,
        payload: group.parts.join(''),
        order: group.order
      });
    });

    entries
      .sort((a, b) => a.order - b.order)
      .forEach(entry => {
        if (!entry.payload.trim()) return;
        data[entry.collection].push(JSON.parse(decodePayload(entry.payload)));
      });

    return data;
  }

  function isPayloadRows(rows) {
    const firstRow = normalizeRows(rows)[0] || [];
    const lowered = firstRow.map(cell => cell.trim().toLowerCase());
    return lowered.includes('collection') && lowered.includes('payload');
  }

  function tableRows(table) {
    return trimRows(table?.cells || [['']]);
  }

  function formDefinitionRows(form) {
    const rows = [
      ['Название', form?.name || ''],
      ['Описание', form?.description || ''],
      ['Владелец', form?.owner || ''],
      ['Статус', form?.status || ''],
      [],
      ['Поле', 'Тип', 'Обязательное', 'Варианты', 'Мин', 'Макс']
    ];

    (form?.fields || []).forEach(field => {
      rows.push([
        field.label || '',
        FORM_FIELD_TYPES[field.type] || field.type || '',
        field.required ? 'Да' : 'Нет',
        (field.options || []).join(', '),
        field.min ?? '',
        field.max ?? ''
      ]);
    });

    return trimRows(rows);
  }

  function responseRows(form, responses) {
    const fields = form?.fields || [];
    const rows = [['Дата', 'Пользователь', ...fields.map(field => field.label || field.id || '')]];
    responses.forEach(response => {
      rows.push([
        response.submittedAt || '',
        response.user || '',
        ...fields.map(field => valueForCell(response.answers?.[field.id]))
      ]);
    });
    return trimRows(rows);
  }

  function objectRows(items, headers) {
    return [
      headers.map(header => header.label),
      ...(items || []).map(item => headers.map(header => valueForCell(item[header.key])))
    ];
  }

  function tableSheetNameMap(tables) {
    const used = new Set();
    const map = new Map();
    (tables || []).forEach((table, index) => {
      const name = sheetName(table.name, used, 'Таблица ' + (index + 1));
      map.set(name, table);
    });
    return map;
  }

  function buildSheetDefinitions(data) {
    const used = new Set();
    const sheets = [];
    const tables = Array.isArray(data?.tables) ? data.tables : [];
    const forms = Array.isArray(data?.forms) ? data.forms : [];
    const responses = Array.isArray(data?.responses) ? data.responses : [];

    tables.forEach((table, index) => {
      sheets.push({
        kind: 'table',
        name: sheetName(table.name, used, 'Таблица ' + (index + 1)),
        rows: tableRows(table)
      });
    });

    forms.forEach((form, index) => {
      sheets.push({
        kind: 'form',
        name: sheetName('Форма - ' + (form.name || index + 1), used, 'Форма ' + (index + 1)),
        rows: formDefinitionRows(form)
      });

      const formResponses = responses.filter(response => response.formId === form.id);
      if (formResponses.length) {
        sheets.push({
          kind: 'responses',
          name: sheetName('Ответы - ' + (form.name || index + 1), used, 'Ответы ' + (index + 1)),
          rows: responseRows(form, formResponses)
        });
      }
    });

    if (Array.isArray(data?.users) && data.users.length) {
      sheets.push({
        kind: 'users',
        name: sheetName('Пользователи', used),
        rows: objectRows(data.users, [
          { key: 'login', label: 'Логин' },
          { key: 'role', label: 'Роль' },
          { key: 'createdAt', label: 'Создан' }
        ])
      });
    }

    if (Array.isArray(data?.tableLogs) && data.tableLogs.length) {
      sheets.push({
        kind: 'tableLogs',
        name: sheetName('Журнал таблиц', used),
        rows: objectRows(data.tableLogs, [
          { key: 'tableName', label: 'Таблица' },
          { key: 'action', label: 'Действие' },
          { key: 'user', label: 'Пользователь' },
          { key: 'date', label: 'Дата' }
        ])
      });
    }

    if (Array.isArray(data?.formLogs) && data.formLogs.length) {
      sheets.push({
        kind: 'formLogs',
        name: sheetName('Журнал форм', used),
        rows: objectRows(data.formLogs, [
          { key: 'formName', label: 'Форма' },
          { key: 'action', label: 'Действие' },
          { key: 'user', label: 'Пользователь' },
          { key: 'date', label: 'Дата' }
        ])
      });
    }

    if (!sheets.length) {
      sheets.push({
        kind: 'empty',
        name: sheetName('Экспорт', used),
        rows: [['Нет данных для экспорта']]
      });
    }

    sheets.push({
      kind: 'system',
      name: sheetName(SYSTEM_SHEET_NAME, used),
      rows: rowsFromData(data),
      hidden: true
    });

    return sheets;
  }

  function makeXlsxCell(cell, rowIndex, colIndex) {
    const ref = columnName(colIndex) + (rowIndex + 1);
    const style = rowIndex === 0 ? ' s="1"' : '';
    const value = valueForCell(cell);
    if (isNumericCell(value)) {
      return '<c r="' + ref + '"' + style + '><v>' + value.replace(',', '.') + '</v></c>';
    }
    return '<c r="' + ref + '" t="inlineStr"' + style + '><is><t xml:space="preserve">' + escapeXml(safeSpreadsheetText(value)) + '</t></is></c>';
  }

  function makeXlsxSheet(rows) {
    const cleanRows = trimRows(rows);
    const rowXml = cleanRows.map((row, rowIndex) => {
      const cells = row.map((cell, colIndex) => makeXlsxCell(cell, rowIndex, colIndex)).join('');
      return '<row r="' + (rowIndex + 1) + '">' + cells + '</row>';
    }).join('');

    const widthCount = Math.max(1, cleanRows[0]?.length || 1);
    const cols = Array.from({ length: widthCount }, (_value, index) =>
      '<col min="' + (index + 1) + '" max="' + (index + 1) + '" width="18" customWidth="1"/>'
    ).join('');
    const dimension = 'A1:' + columnName(Math.max(0, widthCount - 1)) + cleanRows.length;

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<dimension ref="' + dimension + '"/><sheetViews><sheetView workbookViewId="0"/></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="15"/><cols>' + cols + '</cols><sheetData>' + rowXml + '</sheetData></worksheet>';
  }

  function createXlsxBlob(data) {
    const { zipSync, strToU8 } = zipLib();
    const sheets = buildSheetDefinitions(data);
    const sheetOverrides = sheets.map((_sheet, index) =>
      '<Override PartName="/xl/worksheets/sheet' + (index + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
    ).join('');
    const workbookSheets = sheets.map((sheet, index) =>
      '<sheet name="' + escapeXml(sheet.name) + '" sheetId="' + (index + 1) + '" ' +
      (sheet.hidden ? 'state="hidden" ' : '') + 'r:id="rId' + (index + 1) + '"/>'
    ).join('');
    const workbookRels = sheets.map((_sheet, index) =>
      '<Relationship Id="rId' + (index + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (index + 1) + '.xml"/>'
    ).join('') +
      '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>';

    const entries = {
      '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        sheetOverrides +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '</Types>'),
      '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
        '</Relationships>'),
      'docProps/app.xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ' +
        'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Tables Forms Prototype</Application></Properties>'),
      'docProps/core.xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
        'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
        'xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
        '<dc:title>Tables Forms Export</dc:title><dc:creator>Tables Forms Prototype</dc:creator>' +
        '<dcterms:created xsi:type="dcterms:W3CDTF">' + new Date().toISOString() + '</dcterms:created></cp:coreProperties>'),
      'xl/workbook.xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets>' + workbookSheets + '</sheets></workbook>'),
      'xl/_rels/workbook.xml.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + workbookRels + '</Relationships>'),
      'xl/styles.xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
        '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
        '<borders count="1"><border/></borders><cellStyleXfs count="1"><xf fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="2"><xf fontId="0" fillId="0" borderId="0" xfId="0"/><xf fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>')
    };

    sheets.forEach((sheet, index) => {
      entries['xl/worksheets/sheet' + (index + 1) + '.xml'] = strToU8(makeXlsxSheet(sheet.rows));
    });

    return new Blob([zipSync(entries, { level: 6 })], { type: XLSX_TYPE });
  }

  function makeOdsCell(cell) {
    const value = valueForCell(cell);
    if (isNumericCell(value)) {
      return '<table:table-cell office:value-type="float" office:value="' + escapeXml(value.replace(',', '.')) + '"><text:p>' + escapeXml(value) + '</text:p></table:table-cell>';
    }
    return '<table:table-cell office:value-type="string"><text:p>' + escapeXml(safeSpreadsheetText(value)) + '</text:p></table:table-cell>';
  }

  function makeOdsContent(sheets) {
    const tableXml = sheets.map(sheet => {
      const rowXml = trimRows(sheet.rows).map(row =>
        '<table:table-row>' + row.map(makeOdsCell).join('') + '</table:table-row>'
      ).join('');
      return '<table:table table:name="' + escapeXml(sheet.name) + '"' +
        (sheet.hidden ? ' table:visibility="collapse"' : '') + '>' + rowXml + '</table:table>';
    }).join('');

    return '<?xml version="1.0" encoding="UTF-8"?>' +
      '<office:document-content office:version="1.2" ' +
      'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
      'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" ' +
      'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">' +
      '<office:body><office:spreadsheet>' + tableXml + '</office:spreadsheet></office:body></office:document-content>';
  }

  function createOdsBlob(data) {
    const { zipSync, strToU8 } = zipLib();
    const sheets = buildSheetDefinitions(data);
    const entries = {
      mimetype: [strToU8(ODS_TYPE), { level: 0 }],
      'META-INF/manifest.xml': strToU8('<?xml version="1.0" encoding="UTF-8"?>' +
        '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">' +
        '<manifest:file-entry manifest:media-type="' + ODS_TYPE + '" manifest:full-path="/"/>' +
        '<manifest:file-entry manifest:media-type="text/xml" manifest:full-path="content.xml"/>' +
        '<manifest:file-entry manifest:media-type="text/xml" manifest:full-path="styles.xml"/>' +
        '</manifest:manifest>'),
      'content.xml': strToU8(makeOdsContent(sheets)),
      'styles.xml': strToU8('<?xml version="1.0" encoding="UTF-8"?>' +
        '<office:document-styles office:version="1.2" ' +
        'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"></office:document-styles>')
    };
    return new Blob([zipSync(entries, { level: 6 })], { type: ODS_TYPE });
  }

  function parseXml(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) {
      throw new Error('Некорректная XML-структура внутри spreadsheet-файла.');
    }
    return doc;
  }

  function byLocalName(node, localName) {
    return Array.from(node.getElementsByTagName('*')).filter(el => el.localName === localName);
  }

  function directChildrenByLocalName(node, localName) {
    return Array.from(node.children || []).filter(el => el.localName === localName);
  }

  function textFromLocalName(node, localName) {
    return byLocalName(node, localName).map(el => el.textContent || '').join('');
  }

  function parseSharedStrings(zip, strFromU8) {
    if (!zip['xl/sharedStrings.xml']) return [];
    const doc = parseXml(strFromU8(zip['xl/sharedStrings.xml']));
    return byLocalName(doc, 'si').map(si => textFromLocalName(si, 't'));
  }

  function readXlsxCell(cell, sharedStrings) {
    const type = cell.getAttribute('t') || '';
    if (type === 'inlineStr') return textFromLocalName(cell, 't');
    const value = textFromLocalName(cell, 'v');
    if (type === 's') return sharedStrings[Number(value)] || '';
    return value;
  }

  function parseXlsxSheetRows(sheetEntry, sharedStrings, strFromU8) {
    const doc = parseXml(strFromU8(sheetEntry));
    return byLocalName(doc, 'row').map(rowNode => {
      const row = [];
      directChildrenByLocalName(rowNode, 'c').forEach(cell => {
        row[columnIndex(cell.getAttribute('r'))] = readXlsxCell(cell, sharedStrings);
      });
      return row;
    });
  }

  function resolveXlsxTarget(target) {
    const clean = String(target || '').replace(/^\/+/, '');
    if (clean.startsWith('xl/')) return clean;
    return 'xl/' + clean.replace(/^\.\//, '');
  }

  function parseWorkbookRelationships(zip, strFromU8) {
    const rels = new Map();
    if (!zip['xl/_rels/workbook.xml.rels']) return rels;
    const doc = parseXml(strFromU8(zip['xl/_rels/workbook.xml.rels']));
    byLocalName(doc, 'Relationship').forEach(rel => {
      rels.set(rel.getAttribute('Id'), resolveXlsxTarget(rel.getAttribute('Target')));
    });
    return rels;
  }

  function parseXlsxSheets(arrayBuffer) {
    const { unzipSync, strFromU8 } = zipLib();
    const zip = unzipSync(new Uint8Array(arrayBuffer));
    assertZipBudget(zip);
    const sharedStrings = parseSharedStrings(zip, strFromU8);
    const rels = parseWorkbookRelationships(zip, strFromU8);
    const sheets = [];

    if (zip['xl/workbook.xml']) {
      const workbook = parseXml(strFromU8(zip['xl/workbook.xml']));
      byLocalName(workbook, 'sheet').forEach((sheetNode, index) => {
        const id = sheetNode.getAttribute('r:id');
        const target = rels.get(id) || 'xl/worksheets/sheet' + (index + 1) + '.xml';
        if (!zip[target]) return;
        sheets.push({
          name: sheetNode.getAttribute('name') || 'Лист ' + (index + 1),
          hidden: ['hidden', 'veryHidden'].includes(sheetNode.getAttribute('state')),
          rows: parseXlsxSheetRows(zip[target], sharedStrings, strFromU8)
        });
      });
    }

    if (sheets.length) return sheets;

    return Object.keys(zip)
      .filter(name => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
      .sort()
      .map((name, index) => ({
        name: 'Лист ' + (index + 1),
        hidden: false,
        rows: parseXlsxSheetRows(zip[name], sharedStrings, strFromU8)
      }));
  }

  function repeatedValue(node, attrName) {
    return Number(
      node.getAttribute('table:' + attrName) ||
      node.getAttribute(attrName) ||
      node.getAttributeNS('urn:oasis:names:tc:opendocument:xmlns:table:1.0', attrName) ||
      1
    );
  }

  function parseOdsTableRows(table) {
    const rows = [];
    directChildrenByLocalName(table, 'table-row').forEach(rowNode => {
      const row = [];
      directChildrenByLocalName(rowNode, 'table-cell').forEach(cell => {
        const value = textFromLocalName(cell, 'p') || cell.textContent || '';
        const repeat = Math.max(1, Math.min(64, repeatedValue(cell, 'number-columns-repeated')));
        for (let i = 0; i < repeat; i += 1) row.push(value);
      });
      const rowRepeat = Math.max(1, Math.min(1000, repeatedValue(rowNode, 'number-rows-repeated')));
      for (let i = 0; i < rowRepeat; i += 1) rows.push(row.slice());
    });
    return rows;
  }

  function parseOdsSheets(arrayBuffer) {
    const { unzipSync, strFromU8 } = zipLib();
    const zip = unzipSync(new Uint8Array(arrayBuffer));
    assertZipBudget(zip);
    if (!zip['content.xml']) throw new Error('В ODS не найден content.xml.');

    const doc = parseXml(strFromU8(zip['content.xml']));
    return byLocalName(doc, 'table').map((table, index) => ({
      name: table.getAttribute('table:name') || table.getAttribute('name') || 'Лист ' + (index + 1),
      hidden: table.getAttribute('table:visibility') === 'collapse' || table.getAttribute('visibility') === 'collapse',
      rows: parseOdsTableRows(table)
    }));
  }

  function shouldImportAsLooseTable(sheet) {
    if (!sheet || sheet.hidden || isPayloadRows(sheet.rows)) return false;
    const name = sheet.name || '';
    if (name.startsWith('Форма -') || name.startsWith('Ответы -')) return false;
    return !['Пользователи', 'Журнал таблиц', 'Журнал форм'].includes(name);
  }

  function applyVisibleTableEdits(data, sheets) {
    const tableMap = tableSheetNameMap(data.tables || []);
    sheets.forEach(sheet => {
      const table = tableMap.get(sheet.name);
      if (table && !sheet.hidden && !isPayloadRows(sheet.rows)) {
        table.cells = trimRows(sheet.rows);
      }
    });
  }

  function parseSpreadsheetData(arrayBuffer, format) {
    const sheets = format === 'xlsx' ? parseXlsxSheets(arrayBuffer) : parseOdsSheets(arrayBuffer);
    const payloadSheet = sheets.find(sheet => sheet.name === SYSTEM_SHEET_NAME && isPayloadRows(sheet.rows)) ||
      sheets.find(sheet => isPayloadRows(sheet.rows));

    if (payloadSheet) {
      const data = parseRowsToData(payloadSheet.rows);
      applyVisibleTableEdits(data, sheets);
      return data;
    }

    const data = emptyData();
    data.tables = sheets.filter(shouldImportAsLooseTable).map((sheet, index) => ({
      id: 'imported-table-' + Date.now() + '-' + index,
      name: sheet.name || 'Импортированная таблица ' + (index + 1),
      owner: 'Импорт',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      comment: '',
      cells: trimRows(sheet.rows),
      history: []
    }));
    return data;
  }

  function createSpreadsheetBlob(data, format) {
    if (format === 'xlsx') return createXlsxBlob(data);
    if (format === 'ods') return createOdsBlob(data);
    throw new Error('Неподдерживаемый spreadsheet-формат.');
  }

  window.AppSpreadsheet = {
    createSpreadsheetBlob,
    parseSpreadsheetData
  };
})();
