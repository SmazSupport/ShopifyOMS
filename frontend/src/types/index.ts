export interface Shop {
  id: string;
  shopify_domain: string;
  name: string;
  tenant_id: string;
}

export interface Order {
  id: string;
  shop_id: string;
  shopify_order_id: string;
  status: string;
  tags: string[];
  created_at: string;
}

export interface LineItem {
  id: string;
  order_id: string;
  sku: string;
  quantity: number;
  product_title: string;
  variant_id: string;
}
