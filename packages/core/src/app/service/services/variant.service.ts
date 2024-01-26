import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { convertToCent } from '../utils/prices.util';

import {
  CreateVariantInput,
  ListInput,
  UpdateVariantInput,
} from '@/app/api/common';
import {
  ID,
  OptionValueEntity,
  ProductEntity,
  VariantEntity,
} from '@/app/persistance';
import { UserInputError, ValidationError } from '@/lib/errors';

@Injectable()
export class VariantService {
  constructor(
    @InjectRepository(VariantEntity)
    private variantRepository: Repository<VariantEntity>,
    @InjectRepository(ProductEntity)
    private productRepository: Repository<ProductEntity>,
    @InjectRepository(OptionValueEntity)
    private optionValueRepository: Repository<OptionValueEntity>,
  ) {}

  async find(input: ListInput) {
    return this.variantRepository.find(input);
  }

  async findUnique(id: ID) {
    return this.findById(id);
  }

  async create(productId: ID, input: CreateVariantInput) {
    if (!input.optionValuesIds?.length) {
      const defaultVariantAlreadyCreated = await this.variantRepository.findOne(
        { where: { product: { id: productId } } },
      );

      if (defaultVariantAlreadyCreated) {
        throw new ValidationError(
          'Default variant already created, add options instead',
        );
      }
    }

    const optionValues = input.optionValuesIds?.length
      ? await this.optionValueRepository.find({
          where: { id: In(input.optionValuesIds) },
        })
      : undefined;

    const product = await this.productRepository.findOneBy({ id: productId });

    const variantToSave = this.variantRepository.create({
      ...input,
      product,
      price: convertToCent(input.price),
      options: optionValues,
    });
    await this.variantRepository.save(variantToSave);

    return variantToSave;
  }

  async update(id: ID, input: UpdateVariantInput) {
    const variantToUpdate = await this.findById(id);

    if (!variantToUpdate) {
      throw new UserInputError('Variant not found');
    }

    const optionValues = input.optionValuesIds?.length
      ? await this.optionValueRepository.find({
          where: { id: In(input.optionValuesIds) },
        })
      : undefined;

    return this.variantRepository.save({
      ...variantToUpdate,
      ...input,
      price: input.price ? convertToCent(input.price) : variantToUpdate.price,
      options: optionValues,
    });
  }

  async remove(id: ID) {
    const variantToRemove = await this.findById(id);

    if (!variantToRemove) {
      throw new UserInputError('Variant not found with the given id');
    }

    await this.variantRepository.softDelete({ id });

    return true;
  }

  private async findById(id: ID) {
    return this.variantRepository.findOne({ where: { id } });
  }
}
