export interface CategoriaUniversal {
  marketplace?: string;
  categoria_id: string;
  nome?: string;
  caminho?: string[];
}

export interface VariacaoUniversal {
  id?: string;
  sku: string;
  titulo?: string;
  atributos?: Record<string, string>;
  preco?: number;
  estoque?: number;
  imagens?: string[];
}

export interface ProdutoUniversal {
  id_interno: string;
  sku: string;
  titulo: string;
  descricao: string;
  preco: number;
  estoque: number;
  imagens: string[];
  variacoes: VariacaoUniversal[];
  categorias: CategoriaUniversal[];
  atributos?: Record<string, string | number | boolean>;
  metadata?: Record<string, unknown>;
}