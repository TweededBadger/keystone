import { createSystem, initConfig } from '@keystone-6/core/system';
import { relationship, text } from '@keystone-6/core/fields';
import { list, ListSchemaConfig } from '@keystone-6/core';
import { allowAll } from '@keystone-6/core/access';
import { testConfig } from '../utils';

type ListConfig = {
  isFilterable?: false;
  isOrderable?: false;
  omit?:
    | true
    | {
        query?: boolean;
        create?: boolean;
        update?: boolean;
        delete?: boolean;
      };
};

type FieldConfig = {
  isFilterable?: false;
  isOrderable?: false;
  omit?:
    | true
    | {
        read: boolean;
        create: boolean;
        update: boolean;
      };
};

function yesNo(x: boolean | undefined) {
  if (x === true) return 'True';
  if (x === false) return 'False';
  return 'Undefined';
}

function getListPrefix({ isFilterable, isOrderable, omit }: ListConfig) {
  const keys: any = {
    Filterable: yesNo(isFilterable),
    Orderable: yesNo(isOrderable),
  };

  if (omit === undefined) {
    keys.Omit = 'Undefined';
  } else if (omit === true) {
    keys.Omit = 'True';
  } else {
    keys.OmitQuery = yesNo(omit.query);
    keys.OmitCreate = yesNo(omit.create);
    keys.OmitUpdate = yesNo(omit.update);
    keys.OmitDelete = yesNo(omit.delete);
  }

  return Object.entries(keys)
    .map(([k, v]) => `${k}${v}`)
    .join('_');
}

function getFieldPrefix({ isFilterable, isOrderable, omit }: FieldConfig) {
  const keys: any = {
    Filterable: yesNo(isFilterable),
    Orderable: yesNo(isOrderable),
  };

  if (omit === undefined) {
    keys.Omit = 'Undefined';
  } else if (omit === true) {
    keys.Omit = 'True';
  } else {
    keys.OmitRead = yesNo(omit.read);
    keys.OmitCreate = yesNo(omit.create);
    keys.OmitUpdate = yesNo(omit.update);
  }

  return Object.entries(keys)
    .map(([k, v]) => `${k}${v}`)
    .join('_');
}

function getListName(config: ListConfig) {
  return `List_${getListPrefix(config)}`;
}

function getFieldName(config: FieldConfig) {
  return `Field_${getFieldPrefix(config)}`;
}

const listConfigVariables: ListConfig[] = [];
for (const isFilterable of [undefined, false as const]) {
  for (const isOrderable of [undefined, false as const]) {
    for (const flag of [undefined, true, false]) {
      if (flag === undefined || flag === true) {
        listConfigVariables.push({ isFilterable, isOrderable, omit: flag });
      } else {
        for (const query of [undefined, 'query']) {
          for (const create of [undefined, 'create']) {
            for (const update of [undefined, 'update']) {
              for (const _delete of [undefined, 'delete']) {
                const omit = [query, create, update, _delete].filter(x => x) as ListConfig['omit'];
                listConfigVariables.push({ isFilterable, isOrderable, omit });
              }
            }
          }
        }
      }
    }
  }
}

const fieldMatrix: FieldConfig[] = [];
for (const isFilterable of [undefined, false as const]) {
  for (const isOrderable of [undefined, false as const]) {
    for (const flag of [undefined, true, false]) {
      if (flag === undefined || flag === true) {
        fieldMatrix.push({ isFilterable, isOrderable, omit: flag });
      } else {
        for (const read of [false, true]) {
          for (const create of [false, true]) {
            for (const update of [false, true]) {
              fieldMatrix.push({
                isFilterable,
                isOrderable,
                omit: {
                  read,
                  create,
                  update,
                },
              });
            }
          }
        }
      }
    }
  }
}

const createFieldStatic = (config: FieldConfig) => ({
  [getFieldName(config)]: text({
    graphql: { omit: config.omit },
    isFilterable: config.isFilterable,
    isOrderable: config.isOrderable,
  }),
});

const lists: ListSchemaConfig = {};

for (const listConfig of listConfigVariables) {
  lists[getListName(listConfig)] = list({
    access: allowAll,
    fields: Object.assign(
      { name: text() },
      ...fieldMatrix.map(variation => createFieldStatic(variation))
    ),
    defaultIsFilterable: listConfig.isFilterable,
    defaultIsOrderable: listConfig.isOrderable,
    graphql: { omit: listConfig.omit },
  });
}

lists.RelatedToAll = list({
  access: allowAll,
  fields: Object.assign(
    {},
    ...listConfigVariables.map(listConfig => ({
      [`${getListPrefix(listConfig)}one`]: relationship({
        ref: getListName(listConfig),
        many: false,
      }),
      [`${getListPrefix(listConfig)}many`]: relationship({
        ref: getListName(listConfig),
        many: true,
      }),
    }))
  ),
});

const config = testConfig({
  lists,
  ui: {
    isAccessAllowed: () => true,
  },
});

const introspectionQuery = `{
  __schema {
    types {
      name
      fields {
        name
      }
      inputFields {
        name
      }
    }
    queryType {
      fields {
        name
      }
    }
    mutationType {
      fields {
        name
      }
    }
  }
  keystone {
    adminMeta {
      lists {
        key
        fields {
          path
          createView { fieldMode }
          itemView(id: "mock") { fieldMode }
          listView { fieldMode }
          isFilterable
          isOrderable
        }
      }
    }
  }
}`;

class FakePrismaClient {
  $on() {}
  async findMany() {
    return [{ id: 'mock' }];
  }
}

function dropPostgresThings(data: any) {
  data.__schema.types = data.__schema.types.filter((x: any) => x.name !== 'QueryMode');
  for (const x of data.__schema.types) {
    x.inputFields = x.inputFields?.filter((x: any) => x.name !== 'mode');
  }
}

describe(`Schema`, () => {
  const { getKeystone } = createSystem(initConfig(config));
  const { context } = getKeystone({ PrismaClient: FakePrismaClient, Prisma: {} as any });

  test('Public', async () => {
    const data = (await context.graphql.run({ query: introspectionQuery })) as Record<string, any>;
    dropPostgresThings(data);

    expect(JSON.stringify(data, null, 2)).toMatchSnapshot();

    for (const listKey in lists) {
      if (listKey.endsWith('OmitTrue')) {
        expect(data.keystone.adminMeta.lists.some((x: any) => x.key === listKey)).toBe(false);
      } else {
        expect(data.keystone.adminMeta.lists.some((x: any) => x.key === listKey)).not.toBe(
          undefined
        );
      }
    }
  });

  test('Sudo', async () => {
    const data = (await context.graphql.run({ query: introspectionQuery })) as Record<string, any>;
    dropPostgresThings(data);

    expect(JSON.stringify(data, null, 2)).toMatchSnapshot();
    for (const listKey in lists) {
      if (listKey.endsWith('OmitTrue')) {
        expect(data.keystone.adminMeta.lists.some((x: any) => x.key === listKey)).toBe(false);
      } else {
        expect(data.keystone.adminMeta.lists.some((x: any) => x.key === listKey)).not.toBe(
          undefined
        );
      }
    }
  });
});
