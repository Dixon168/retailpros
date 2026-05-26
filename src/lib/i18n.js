// src/lib/i18n.js
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const LANGS = [
  { code: 'en', label: 'EN', name: 'English',    flag: '🇺🇸' },
  { code: 'zh', label: '中',  name: '中文',       flag: '🇨🇳' },
  { code: 'es', label: 'ES', name: 'Español',    flag: '🇪🇸' },
  { code: 'ko', label: '한',  name: '한국어',      flag: '🇰🇷' },
  { code: 'vi', label: 'VI', name: 'Tiếng Việt', flag: '🇻🇳' },
]

export const T = {
  // ── Navigation ──
  dashboard:      { en:'Dashboard',    zh:'仪表板',   es:'Panel',       ko:'대시보드',  vi:'Bảng điều khiển' },
  orders:         { en:'Orders',       zh:'订单',     es:'Pedidos',     ko:'주문',     vi:'Đơn hàng' },
  reports:        { en:'Reports',      zh:'报告',     es:'Informes',    ko:'보고서',   vi:'Báo cáo' },
  products:       { en:'Products',     zh:'产品',     es:'Productos',   ko:'제품',     vi:'Sản phẩm' },
  categories:     { en:'Categories',   zh:'分类',     es:'Categorías',  ko:'카테고리', vi:'Danh mục' },
  vendors:        { en:'Vendors',      zh:'供应商',   es:'Proveedores', ko:'공급업체', vi:'Nhà cung cấp' },
  members:        { en:'Members',      zh:'会员',     es:'Miembros',    ko:'회원',     vi:'Thành viên' },
  loyalty:        { en:'Loyalty',      zh:'忠诚度',   es:'Lealtad',     ko:'충성도',   vi:'Khách hàng thân thiết' },
  marketing:      { en:'Marketing',    zh:'营销',     es:'Marketing',   ko:'마케팅',   vi:'Tiếp thị' },
  invoices:       { en:'Invoices',     zh:'发票',     es:'Facturas',    ko:'청구서',   vi:'Hóa đơn' },
  settings:       { en:'Settings',     zh:'设置',     es:'Ajustes',     ko:'설정',     vi:'Cài đặt' },
  promotions:     { en:'Promotions',   zh:'促销',     es:'Promociones', ko:'프로모션', vi:'Khuyến mãi' },

  // ── POS ──
  pos:            { en:'POS',          zh:'收银台',   es:'TPV',         ko:'POS',     vi:'Quầy thu' },
  pay:            { en:'PAY',          zh:'收款',     es:'PAGAR',       ko:'결제',    vi:'THANH TOÁN' },
  member:         { en:'Member',       zh:'会员',     es:'Miembro',     ko:'회원',    vi:'Thành viên' },
  points:         { en:'Points',       zh:'积分',     es:'Puntos',      ko:'포인트',  vi:'Điểm' },
  openItem:       { en:'Open Item',    zh:'自定义商品', es:'Item Libre',  ko:'자유상품', vi:'Mặt hàng tự do' },
  return:         { en:'Return',       zh:'退货',     es:'Devolver',    ko:'반품',    vi:'Trả hàng' },
  hold:           { en:'Hold',         zh:'挂单',     es:'Pausar',      ko:'보류',    vi:'Tạm giữ' },
  recall:         { en:'Recall',       zh:'找单',     es:'Recuperar',   ko:'불러오기', vi:'Gọi lại' },
  cancel:         { en:'Cancel',       zh:'取消',     es:'Cancelar',    ko:'취소',    vi:'Hủy' },
  discount:       { en:'Discount',     zh:'折扣',     es:'Descuento',   ko:'할인',    vi:'Giảm giá' },
  remark:         { en:'Remark',       zh:'备注',     es:'Nota',        ko:'비고',    vi:'Ghi chú' },
  walkIn:         { en:'Walk-in',      zh:'散客',     es:'Sin cuenta',  ko:'일반 고객', vi:'Khách vãng lai' },
  subtotal:       { en:'Subtotal',     zh:'小计',     es:'Subtotal',    ko:'소계',    vi:'Tạm tính' },
  tax:            { en:'Tax',          zh:'税',       es:'Impuesto',    ko:'세금',    vi:'Thuế' },
  total:          { en:'Total',        zh:'合计',     es:'Total',       ko:'합계',    vi:'Tổng cộng' },
  cart:           { en:'Cart',         zh:'购物车',   es:'Carrito',     ko:'장바구니', vi:'Giỏ hàng' },
  search:         { en:'Search',       zh:'搜索',     es:'Buscar',      ko:'검색',    vi:'Tìm kiếm' },
  backOffice:     { en:'Back Office',  zh:'后台',     es:'Oficina',     ko:'백오피스', vi:'Văn phòng' },

  // ── Products ──
  addProduct:     { en:'Add Product',  zh:'添加产品', es:'Añadir',      ko:'상품 추가', vi:'Thêm sản phẩm' },
  price:          { en:'Price',        zh:'价格',     es:'Precio',      ko:'가격',    vi:'Giá' },
  cost:           { en:'Cost',         zh:'成本',     es:'Costo',       ko:'원가',    vi:'Chi phí' },
  stock:          { en:'Stock',        zh:'库存',     es:'Stock',       ko:'재고',    vi:'Tồn kho' },

  // ── Customers ──
  newCustomer:    { en:'New Customer', zh:'新会员',   es:'Nuevo cliente', ko:'신규 고객', vi:'Khách hàng mới' },
  name:           { en:'Name',         zh:'姓名',     es:'Nombre',      ko:'이름',    vi:'Tên' },
  phone:          { en:'Phone',        zh:'电话',     es:'Teléfono',    ko:'전화',    vi:'Điện thoại' },
  email:          { en:'Email',        zh:'邮箱',     es:'Correo',      ko:'이메일',  vi:'Email' },
  birthday:       { en:'Birthday',     zh:'生日',     es:'Cumpleaños',  ko:'생일',    vi:'Sinh nhật' },
  gender:         { en:'Gender',       zh:'性别',     es:'Género',      ko:'성별',    vi:'Giới tính' },
  address:        { en:'Address',      zh:'地址',     es:'Dirección',   ko:'주소',    vi:'Địa chỉ' },
  notes:          { en:'Notes',        zh:'备注',     es:'Notas',       ko:'메모',    vi:'Ghi chú' },
  balance:        { en:'Balance',      zh:'余额',     es:'Saldo',       ko:'잔액',    vi:'Số dư' },
  topUp:          { en:'Top Up',       zh:'充值',     es:'Recargar',    ko:'충전',    vi:'Nạp tiền' },
  expires:        { en:'Expires',      zh:'到期',     es:'Vence',       ko:'만료',    vi:'Hết hạn' },
  memberLevel:    { en:'Member Level', zh:'会员等级', es:'Nivel',       ko:'회원 등급', vi:'Cấp thành viên' },
  cardNumber:     { en:'Card #',       zh:'卡号',     es:'Tarjeta',     ko:'카드 번호', vi:'Số thẻ' },
  transactions:   { en:'Transactions', zh:'交易记录', es:'Transacciones', ko:'거래내역', vi:'Giao dịch' },
  pointsHistory:  { en:'Points',       zh:'积分记录', es:'Puntos',      ko:'포인트 내역', vi:'Lịch sử điểm' },
  topupHistory:   { en:'Top-up History', zh:'充值记录', es:'Recargas',  ko:'충전 내역', vi:'Lịch sử nạp tiền' },

  // ── Common ──
  save:           { en:'Save',         zh:'保存',     es:'Guardar',     ko:'저장',    vi:'Lưu' },
  edit:           { en:'Edit',         zh:'编辑',     es:'Editar',      ko:'편집',    vi:'Chỉnh sửa' },
  delete:         { en:'Delete',       zh:'删除',     es:'Eliminar',    ko:'삭제',    vi:'Xóa' },
  confirm:        { en:'Confirm',      zh:'确认',     es:'Confirmar',   ko:'확인',    vi:'Xác nhận' },
  close:          { en:'Close',        zh:'关闭',     es:'Cerrar',      ko:'닫기',    vi:'Đóng' },
  add:            { en:'Add',          zh:'添加',     es:'Agregar',     ko:'추가',    vi:'Thêm' },
  loading:        { en:'Loading...',   zh:'加载中...', es:'Cargando...', ko:'로딩 중...', vi:'Đang tải...' },
  noData:         { en:'No data',      zh:'暂无数据', es:'Sin datos',   ko:'데이터 없음', vi:'Không có dữ liệu' },
  male:           { en:'Male',         zh:'男',       es:'Masculino',   ko:'남성',    vi:'Nam' },
  female:         { en:'Female',       zh:'女',       es:'Femenino',    ko:'여성',    vi:'Nữ' },
  other:          { en:'Other',        zh:'其他',     es:'Otro',        ko:'기타',    vi:'Khác' },
  completed:      { en:'Completed',    zh:'完成',     es:'Completado',  ko:'완료',    vi:'Hoàn thành' },
  refunded:       { en:'Refunded',     zh:'退款',     es:'Reembolsado', ko:'환불',    vi:'Hoàn tiền' },
  voided:         { en:'Voided',       zh:'作废',     es:'Anulado',     ko:'취소됨',  vi:'Hủy' },
  onHold:         { en:'On Hold',      zh:'挂单',     es:'En espera',   ko:'보류',    vi:'Tạm giữ' },

  // ── Settings ──
  storeInfo:      { en:'Store Info',   zh:'店铺信息', es:'Tienda',      ko:'매장 정보', vi:'Thông tin cửa hàng' },
  taxRates:       { en:'Tax Rates',    zh:'税率',     es:'Impuestos',   ko:'세율',    vi:'Thuế suất' },
  users:          { en:'Users',        zh:'用户',     es:'Usuarios',    ko:'사용자',  vi:'Người dùng' },
  language:       { en:'Language',     zh:'语言',     es:'Idioma',      ko:'언어',    vi:'Ngôn ngữ' },
  memberLevels:   { en:'Member Levels', zh:'会员等级', es:'Niveles',    ko:'회원 등급', vi:'Cấp thành viên' },
  apiSettings:    { en:'API & Integrations', zh:'API设置', es:'API',    ko:'API 설정', vi:'Cài đặt API' },

  // ── Dashboard ──
  dashSummary:    { en:'Summary',      zh:'汇总',     es:'Resumen',     ko:'요약',     vi:'Tổng hợp' },
  dashEmployee:   { en:'Employee',     zh:'员工',     es:'Empleado',    ko:'직원',     vi:'Nhân viên' },
  dashSales:      { en:'Sales',        zh:'销售',     es:'Ventas',      ko:'판매',     vi:'Bán hàng' },
  allTerminals:   { en:'All Terminals', zh:'所有终端', es:'Todos los TPV', ko:'모든 단말기', vi:'Tất cả thiết bị' },
  allEmployees:   { en:'All Employees', zh:'所有员工', es:'Todos',       ko:'모든 직원', vi:'Tất cả nhân viên' },
  today:          { en:'Today',        zh:'今天',     es:'Hoy',         ko:'오늘',     vi:'Hôm nay' },
  thisWeek:       { en:'Week',         zh:'本周',     es:'Semana',      ko:'이번 주',  vi:'Tuần' },
  thisMonth:      { en:'Month',        zh:'本月',     es:'Mes',         ko:'이번 달',  vi:'Tháng' },
  customRange:    { en:'Custom',       zh:'自定义',   es:'Personalizado', ko:'사용자 지정', vi:'Tùy chỉnh' },
  netSales:       { en:'Net Sales',    zh:'净销售',   es:'Ventas netas', ko:'순매출',  vi:'Doanh thu thuần' },
  totalSales:     { en:'Total Sales',  zh:'总销售',   es:'Ventas totales', ko:'총매출', vi:'Tổng doanh thu' },
  totalCollected: { en:'Total Collected', zh:'总实收', es:'Total cobrado', ko:'총 수금', vi:'Tổng thu' },
  cash:           { en:'Cash',         zh:'现金',     es:'Efectivo',    ko:'현금',     vi:'Tiền mặt' },
  card:           { en:'Card',         zh:'信用卡',   es:'Tarjeta',     ko:'카드',     vi:'Thẻ' },
  giftCard:       { en:'Gift Card',    zh:'礼品卡',   es:'Tarjeta regalo', ko:'기프트카드', vi:'Thẻ quà tặng' },
  memberCard:     { en:'Member Card',  zh:'会员卡',   es:'Tarjeta socio', ko:'회원카드', vi:'Thẻ thành viên' },
  other:          { en:'Other',        zh:'其他',     es:'Otro',        ko:'기타',     vi:'Khác' },
  paymentMethods: { en:'Payment Methods', zh:'付款方式', es:'Métodos de pago', ko:'결제 수단', vi:'Phương thức thanh toán' },
  taxCollected:   { en:'Tax Collected', zh:'税收',    es:'Impuestos',   ko:'세금',     vi:'Thuế' },
  refunds:        { en:'Refunds',      zh:'退款',     es:'Reembolsos',  ko:'환불',     vi:'Hoàn tiền' },
  qty:            { en:'Qty',          zh:'数量',     es:'Cant.',       ko:'수량',     vi:'SL' },
  amount:         { en:'Amount',       zh:'金额',     es:'Importe',     ko:'금액',     vi:'Số tiền' },
  share:          { en:'Share',        zh:'占比',     es:'%',           ko:'비율',     vi:'Tỷ lệ' },
  ordersCount:    { en:'Orders',       zh:'订单数',   es:'Pedidos',     ko:'주문 수',  vi:'Số đơn' },
  revenue:        { en:'Revenue',      zh:'营业额',   es:'Ingresos',    ko:'매출',     vi:'Doanh thu' },
  profit:         { en:'Profit',       zh:'利润',     es:'Beneficio',   ko:'이익',     vi:'Lợi nhuận' },
  commission:     { en:'Commission',   zh:'提成',     es:'Comisión',    ko:'수수료',   vi:'Hoa hồng' },
  tips:           { en:'Tips',         zh:'小费',     es:'Propinas',    ko:'팁',       vi:'Tiền boa' },
  employeeSales:  { en:'Employee Sales', zh:'员工销售', es:'Ventas',     ko:'직원 매출', vi:'Doanh số NV' },
  noData:         { en:'No data',      zh:'暂无数据', es:'Sin datos',   ko:'데이터 없음', vi:'Không có dữ liệu' },
  product:        { en:'Product',      zh:'商品',     es:'Producto',    ko:'상품',     vi:'Sản phẩm' },
  searchProduct:  { en:'Search',       zh:'搜索',     es:'Buscar',      ko:'검색',     vi:'Tìm kiếm' },
  lowStockAlert:  { en:'low stock',    zh:'低库存',   es:'bajo stock',  ko:'재고 부족', vi:'sắp hết hàng' },
  needsAttention: { en:'Needs attention', zh:'需要关注', es:'Requiere atención', ko:'주의 필요', vi:'Cần chú ý' },
  viewDetail:     { en:'View',         zh:'查看',     es:'Ver',         ko:'보기',     vi:'Xem' },
  print:          { en:'Print',        zh:'打印',     es:'Imprimir',    ko:'인쇄',     vi:'In' },

  // ── B2B Dashboard ──
  b2bCenter:      { en:'B2B Center',   zh:'B2B中心',  es:'Centro B2B',  ko:'B2B 센터', vi:'Trung tâm B2B' },
  outstanding:    { en:'Outstanding',  zh:'未收款',   es:'Pendiente',   ko:'미수금',   vi:'Còn nợ' },
  overdue:        { en:'Overdue',      zh:'逾期',     es:'Vencido',     ko:'연체',     vi:'Quá hạn' },
  dueThisWeek:    { en:'Due This Week', zh:'本周到期', es:'Vence esta semana', ko:'이번 주 마감', vi:'Đến hạn tuần này' },
  paidThisMonth:  { en:'Paid This Month', zh:'本月收款', es:'Pagado este mes', ko:'이번 달 수금', vi:'Đã thu tháng này' },
  invoicedPeriod: { en:'Invoiced',     zh:'已开票',   es:'Facturado',   ko:'청구액',   vi:'Đã xuất hóa đơn' },
  collected:      { en:'Collected',    zh:'已收款',   es:'Cobrado',     ko:'수금액',   vi:'Đã thu' },
  topCustomers:   { en:'Top Customers', zh:'主要客户', es:'Mejores clientes', ko:'주요 고객', vi:'Khách hàng lớn' },
  arAging:        { en:'A/R Aging',    zh:'应收账龄', es:'Antigüedad CxC', ko:'채권 연령', vi:'Tuổi nợ' },
  current:        { en:'Current',      zh:'未到期',   es:'Al día',      ko:'정상',     vi:'Hiện tại' },
  days30:         { en:'1-30 days',    zh:'1-30天',   es:'1-30 días',   ko:'1-30일',   vi:'1-30 ngày' },
  days60:         { en:'31-60 days',   zh:'31-60天',  es:'31-60 días',  ko:'31-60일',  vi:'31-60 ngày' },
  days90:         { en:'60+ days',     zh:'60天以上', es:'60+ días',    ko:'60일+',    vi:'60+ ngày' },
  recentActivity: { en:'Recent Activity', zh:'最近活动', es:'Actividad reciente', ko:'최근 활동', vi:'Hoạt động gần đây' },
  quickActions:   { en:'Quick Actions', zh:'快捷操作', es:'Acciones rápidas', ko:'빠른 작업', vi:'Thao tác nhanh' },
  newInvoice:     { en:'New Invoice',  zh:'新建发票', es:'Nueva factura', ko:'새 청구서', vi:'Hóa đơn mới' },
  newEstimate:    { en:'New Estimate', zh:'新建报价', es:'Nuevo presupuesto', ko:'새 견적', vi:'Báo giá mới' },
  receivePayment: { en:'Receive Payment', zh:'收款',  es:'Recibir pago', ko:'결제 받기', vi:'Nhận thanh toán' },
}

// Hook to use translations
export const useLang = () => {
  const { lang } = useLangStore()
  const t = (key) => T[key]?.[lang] || T[key]?.en || key
  return { lang, t }
}

// Store
export const useLangStore = create(
  persist(
    (set) => ({
      lang: 'en',
      setLang: (lang) => set({ lang }),
    }),
    { name: 'retailpos-lang' }
  )
)
