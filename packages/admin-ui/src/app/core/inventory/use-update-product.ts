import { useGqlMutation } from '@/lib/gql';
import { type UpdateProductInput } from '@/lib/vendyx/codegen/graphql';
import { UpdateProductMutation } from '@/lib/vendyx/mutations';

import { useLoading } from '../common';

export const useUpdateProduct = () => {
  const { mutateAsync } = useGqlMutation(UpdateProductMutation);
  const { isLoading } = useLoading();

  const updateProduct = async (productId: string, input: UpdateProductInput) => {
    const {
      updateProduct: { id }
    } = await mutateAsync({ productId, input });

    return id;
  };

  return {
    updateProduct,
    isLoading
  };
};
