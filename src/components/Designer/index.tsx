import React, { useRef, useState, useEffect, useContext, useCallback } from 'react';
import { DesignerReactProps, Template, SchemaForUI, Size } from '../../libs/type';
import Sidebar from './Sidebar';
import Main from './Main';
import { RULER_HEIGHT, ZOOM } from '../../libs/constants';
import { I18nContext } from '../../libs/contexts';
import { uuid, set, cloneDeep, round, arrayMove } from '../../libs/utils';
import {
  fmtTemplate,
  getInitialSchema,
  getSampleByType,
  getKeepRatioHeightByWidth,
  getUniqSchemaKey,
  templateSchemas2SchemasList,
} from '../../libs/helper';
import { initShortCuts, destroyShortCuts } from '../../libs/ui';
import { useUIPreProcessor, useScrollPageCursor } from '../../libs/hooks';
import Root from '../Root';
import Error from '../Error';

const moveCommandToChangeSchemasArg = (props: {
  command: 'up' | 'down' | 'left' | 'right';
  activeSchemas: SchemaForUI[];
  isShift: boolean;
  pageSize: Size;
}) => {
  const { command, activeSchemas, isShift, pageSize } = props;
  const key = command === 'up' || command === 'down' ? 'y' : 'x';
  const num = isShift ? 0.1 : 1;

  const getValue = (as: SchemaForUI) => {
    let value = 0;
    const { position } = as;
    switch (command) {
      case 'up':
        value = round(position.y - num, 2);
        break;
      case 'down':
        value = round(position.y + num, 2);
        break;
      case 'left':
        value = round(position.x - num, 2);
        break;
      case 'right':
        value = round(position.x + num, 2);
        break;
      default:
        break;
    }

    return value;
  };

  return activeSchemas.map((as) => {
    let value = getValue(as);
    const { width, height } = as;
    if (key === 'x') {
      value = value > pageSize.width - width ? round(pageSize.width - width, 2) : value;
    } else {
      value = value > pageSize.height - height ? round(pageSize.height - height, 2) : value;
    }

    return { key: `position.${key}`, value, schemaId: as.id };
  });
};

const TemplateEditor = ({
  template,
  size,
  onSaveTemplate,
  onChangeTemplate,
}: DesignerReactProps & { onChangeTemplate: (t: Template) => void }) => {
  const copiedSchemas = useRef<SchemaForUI[] | null>(null);
  const past = useRef<SchemaForUI[][]>([]);
  const future = useRef<SchemaForUI[][]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const paperRefs = useRef<HTMLDivElement[]>([]);

  const i18n = useContext(I18nContext);

  const { backgrounds, pageSizes, scale, error } = useUIPreProcessor({
    template,
    size,
    offset: RULER_HEIGHT,
  });

  const [hoveringSchemaId, setHoveringSchemaId] = useState<string | null>(null);
  const [activeElements, setActiveElements] = useState<HTMLElement[]>([]);
  const [schemasList, setSchemasList] = useState<SchemaForUI[][]>([[]] as SchemaForUI[][]);
  const [pageCursor, setPageCursor] = useState(0);

  const onEdit = (targets: HTMLElement[]) => {
    setActiveElements(targets);
    setHoveringSchemaId(null);
  };

  const onEditEnd = () => {
    setActiveElements([]);
    setHoveringSchemaId(null);
  };

  useScrollPageCursor({
    rootRef,
    pageSizes,
    scale,
    pageCursor,
    onChangePageCursor: (p) => {
      setPageCursor(p);
      onEditEnd();
    },
  });

  const modifiedTemplate = fmtTemplate(template, schemasList);

  const commitSchemas = useCallback(
    (newSchemas: SchemaForUI[]) => {
      future.current = [];
      past.current.push(cloneDeep(schemasList[pageCursor]));
      const _schemasList = cloneDeep(schemasList);
      _schemasList[pageCursor] = newSchemas;
      setSchemasList(_schemasList);
      onChangeTemplate(fmtTemplate(template, _schemasList));
    },
    [template, schemasList, pageCursor, onChangeTemplate]
  );

  const removeSchemas = useCallback(
    (ids: string[]) => {
      commitSchemas(schemasList[pageCursor].filter((schema) => !ids.includes(schema.id)));
      onEditEnd();
    },
    [schemasList, pageCursor, commitSchemas]
  );

  const changeSchemas = useCallback(
    (objs: { key: string; value: string | number; schemaId: string }[]) => {
      const newSchemas = objs.reduce((acc, { key, value, schemaId }) => {
        const tgt = acc.find((s) => s.id === schemaId)!;
        // Assign to reference
        set(tgt, key, value);
        if (key === 'type') {
          // set default value, text or barcode
          set(tgt, 'data', value === 'text' ? 'text' : getSampleByType(String(value)));
          // For barcodes, adjust the height to get the correct ratio.
          if (value !== 'text' && value !== 'image') {
            set(tgt, 'height', getKeepRatioHeightByWidth(String(value), tgt.width));
          }
        }

        return acc;
      }, cloneDeep(schemasList[pageCursor]));
      commitSchemas(newSchemas);
    },
    [commitSchemas, pageCursor, schemasList]
  );

  const initEvents = useCallback(() => {
    const getActiveSchemas = () => {
      const ids = activeElements.map((ae) => ae.id);

      return schemasList[pageCursor].filter((s) => ids.includes(s.id));
    };
    const timeTavel = (mode: 'undo' | 'redo') => {
      const isUndo = mode === 'undo';
      if ((isUndo ? past : future).current.length <= 0) return;
      (isUndo ? future : past).current.push(cloneDeep(schemasList[pageCursor]));
      const s = cloneDeep(schemasList);
      s[pageCursor] = (isUndo ? past : future).current.pop()!;
      setSchemasList(s);
      onEditEnd();
    };
    initShortCuts({
      move: (command, isShift) => {
        const pageSize = pageSizes[pageCursor];
        const activeSchemas = getActiveSchemas();
        const arg = moveCommandToChangeSchemasArg({ command, activeSchemas, pageSize, isShift });
        changeSchemas(arg);
      },

      copy: () => {
        const activeSchemas = getActiveSchemas();
        if (activeSchemas.length === 0) return;
        copiedSchemas.current = activeSchemas;
      },
      paste: () => {
        if (!copiedSchemas.current || copiedSchemas.current.length === 0) return;
        const schema = schemasList[pageCursor];
        const stackUniqSchemaKeys: string[] = [];
        const pasteSchemas = copiedSchemas.current.map((cs) => {
          const id = uuid();
          const key = getUniqSchemaKey({ copiedSchemaKey: cs.key, schema, stackUniqSchemaKeys });
          const { height, width, position: p } = cs;
          const ps = pageSizes[pageCursor];
          const position = {
            x: p.x + 10 > ps.width - width ? ps.width - width : p.x + 10,
            y: p.y + 10 > ps.height - height ? ps.height - height : p.y + 10,
          };

          return Object.assign(cloneDeep(cs), { id, key, position });
        });
        commitSchemas(schemasList[pageCursor].concat(pasteSchemas));
        onEdit(pasteSchemas.map((s) => document.getElementById(s.id)!));
        copiedSchemas.current = pasteSchemas;
      },
      redo: () => timeTavel('redo'),
      undo: () => timeTavel('undo'),
      save: () => onSaveTemplate && onSaveTemplate(modifiedTemplate),
      remove: () => removeSchemas(getActiveSchemas().map((s) => s.id)),
      esc: onEditEnd,
    });
  }, [
    activeElements,
    changeSchemas,
    commitSchemas,
    modifiedTemplate,
    pageCursor,
    pageSizes,
    removeSchemas,
    onSaveTemplate,
    schemasList,
  ]);

  const destroyEvents = useCallback(() => {
    destroyShortCuts();
  }, []);

  const updateTemplate = useCallback(async (newTemplate: Template) => {
    const sl = await templateSchemas2SchemasList(newTemplate);
    setSchemasList(sl);
    onEditEnd();
    setPageCursor(0);
    if (rootRef.current?.scroll) {
      rootRef.current.scroll({ top: 0, behavior: 'smooth' });
    }
  }, []);

  useEffect(() => {
    updateTemplate(template);
  }, [template, updateTemplate]);

  useEffect(() => {
    initEvents();

    return destroyEvents;
  }, [initEvents, destroyEvents]);

  const addSchema = () => {
    const s = getInitialSchema();
    const paper = paperRefs.current[pageCursor];
    const rectTop = paper ? paper.getBoundingClientRect().top : 0;
    s.position.y = rectTop > 0 ? 0 : pageSizes[pageCursor].height / 2;
    s.data = 'text';
    s.key = `${i18n('field')}${schemasList[pageCursor].length + 1}`;
    commitSchemas(schemasList[pageCursor].concat(s));
    setTimeout(() => onEdit([document.getElementById(s.id)!]));
  };

  const onSortEnd = (arg: { oldIndex: number; newIndex: number }) => {
    const movedSchema = arrayMove(cloneDeep(schemasList[pageCursor]), arg.oldIndex, arg.newIndex);
    commitSchemas(movedSchema);
  };

  const onChangeHoveringSchemaId = (id: string | null) => {
    setHoveringSchemaId(id);
  };

  const getLastActiveSchema = () => {
    if (activeElements.length === 0) return getInitialSchema();
    const last = activeElements[activeElements.length - 1];

    return schemasList[pageCursor].find((s) => s.id === last.id) || getInitialSchema();
  };

  const activeSchema = getLastActiveSchema();

  if (error) {
    return <Error size={size} error={error} />;
  }

  return (
    <Root ref={rootRef} size={size} scale={scale}>
      <Sidebar
        hoveringSchemaId={hoveringSchemaId}
        onChangeHoveringSchemaId={onChangeHoveringSchemaId}
        height={mainRef.current ? mainRef.current.scrollHeight : 0}
        size={size}
        pageSize={pageSizes[pageCursor]}
        activeElement={activeElements[activeElements.length - 1]}
        schemas={schemasList[pageCursor]}
        activeSchema={activeSchema}
        changeSchemas={changeSchemas}
        onSortEnd={onSortEnd}
        onEdit={(id: string) => {
          const editingElem = document.getElementById(id);
          if (editingElem) {
            onEdit([editingElem]);
          }
        }}
        onEditEnd={onEditEnd}
        addSchema={addSchema}
      />
      <Main
        ref={mainRef}
        paperRefs={paperRefs}
        hoveringSchemaId={hoveringSchemaId}
        onChangeHoveringSchemaId={onChangeHoveringSchemaId}
        height={size.height - RULER_HEIGHT * ZOOM}
        pageCursor={pageCursor}
        scale={scale}
        size={size}
        pageSizes={pageSizes}
        backgrounds={backgrounds}
        activeElements={activeElements}
        schemasList={schemasList}
        changeSchemas={changeSchemas}
        removeSchemas={removeSchemas}
        onEdit={onEdit}
      />
    </Root>
  );
};

export default TemplateEditor;