import { api } from '../config.js';

const { defaultPageSize } = api;

const getDbPage = ({ page, pageIndex, pageSize }) => {
  if (pageIndex !== undefined || pageSize !== undefined) {
    const limit = pageSize || defaultPageSize;
    return {
      limit,
      skip: limit * (pageIndex || 0),
    };
  }
  // legacy pagination deprecated
  return { limit: defaultPageSize, skip: page || 0 };
};

const getClientNextPage = ({ resultLength, limit, skip }) => ({
  // legacy pagination deprecated
  nextPage: resultLength === limit ? skip + limit : undefined,
});

export { getDbPage, getClientNextPage };
