import { DataTable } from '@/lib/components/data-table';
import { DataTableSkeleton } from '@/lib/components/skeletons';
import { DEFAULT_PRODUCT_IMAGE } from '@/lib/constants';
import { t } from '@/lib/locales';

import { useGetProducts } from '../../hooks';
import { ProductTableColumns } from './product-table-columns';

export const ProductTable = () => {
  const { products, isLoading } = useGetProducts();

  if (isLoading) {
    return <DataTableSkeleton />;
  }

  const data: TableProduct[] =
    products?.map(p => {
      const variant = p.variants.items[0];
      const image = p.assets.items[0];

      return {
        id: p.id,
        name: p.name,
        slug: p.slug,
        status: p.published ? 'enabled' : 'disabled',
        image: image?.source ?? DEFAULT_PRODUCT_IMAGE,
        price: variant?.price ?? 0,
        sku: variant?.sku,
        stock: variant?.stock
      };
    }) ?? [];

  return (
    <DataTable
      data={data}
      columns={ProductTableColumns}
      search={{ filterKey: 'name', placeholder: t('inventory.table.search') }}
    />
  );
};

export type TableProduct = {
  id: string;
  sku: string;
  image: string;
  name: string;
  slug: string;
  price: number;
  stock: number;
  status: 'enabled' | 'disabled';
};
