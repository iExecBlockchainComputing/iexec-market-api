const categoryModel = require('../models/categoryModel');
const { logger } = require('../utils/logger');
const { throwIfMissing, ObjectNotFoundError } = require('../utils/error');

const PAGE_LENGTH = 20;

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
} = {}) => {
  try {
    const CategoryModel = await categoryModel.getModel(chainId);
    const request = {
      ...(minWorkClockTimeRef !== undefined && {
        workClockTimeRef: { $gte: minWorkClockTimeRef },
      }),
      ...(maxWorkClockTimeRef !== undefined && {
        workClockTimeRef: { $lte: maxWorkClockTimeRef },
      }),
    };
    const sort = {
      workClockTimeRef: 'asc',
      catid: 'asc', // make sort deterministic
    };
    const limit = PAGE_LENGTH;
    const skip = page || 0;

    const count = await CategoryModel.find(request).countDocuments();
    const categories = await CategoryModel.find(request)
      .sort(sort)
      .limit(limit)
      .skip(skip);

    const nextPage = categories.length === limit ? skip + limit : undefined;

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

module.exports = {
  getCategory,
  getCategories,
};
