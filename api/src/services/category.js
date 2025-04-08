import * as categoryModel from '../models/categoryModel.js';
import { logger } from '../utils/logger.js';
import { throwIfMissing, ObjectNotFoundError } from '../utils/error.js';
import { getDbPage, getClientNextPage } from '../utils/pagination-utils.js';

const log = logger.extend('services:category');

log('instantiating service');

const getCategory = async ({
  chainId = throwIfMissing(),
  catid = throwIfMissing(),
} = {}) => {
  try {
    const CategoryModel = await categoryModel.getModel(chainId);
    const request = { catid };
    const category = await CategoryModel.findOne(request);
    if (!category) {
      throw new ObjectNotFoundError('category not found');
    }
    return category.toJSON();
  } catch (e) {
    log('getCategory() error', e);
    throw e;
  }
};

const getCategories = async ({
  chainId = throwIfMissing(),
  minWorkClockTimeRef,
  maxWorkClockTimeRef,
  page,
  pageIndex,
  pageSize,
} = {}) => {
  try {
    const CategoryModel = await categoryModel.getModel(chainId);
    const request = {
      ...((minWorkClockTimeRef !== undefined ||
        maxWorkClockTimeRef !== undefined) && {
        workClockTimeRef: {
          ...(minWorkClockTimeRef !== undefined && {
            $gte: minWorkClockTimeRef,
          }),
          ...(maxWorkClockTimeRef !== undefined && {
            $lte: maxWorkClockTimeRef,
          }),
        },
      }),
    };
    const sort = {
      workClockTimeRef: 'asc',
      catid: 'asc', // make sort deterministic
    };

    const { skip, limit } = getDbPage({
      page,
      pageIndex,
      pageSize,
    });

    const count = await CategoryModel.find(request).countDocuments();
    const categories = await CategoryModel.find(request)
      .sort(sort)
      .limit(limit)
      .skip(skip);

    const { nextPage } = getClientNextPage({
      resultLength: categories.length,
      limit,
      skip,
    });

    return {
      categories: categories.map((e) => e.toJSON()),
      count,
      nextPage,
    };
  } catch (e) {
    log('getCategories() error', e);
    throw e;
  }
};

export { getCategory, getCategories };
