import { Navigate, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { clearSession, getToken, getUser } from "./api";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Products from "./pages/Products";
import Inventory from "./pages/Inventory";
import Orders from "./pages/Orders";
import OrderDetail from "./pages/OrderDetail";

function Layout({ children }: { children: React.ReactNode }) {
  const user = getUser();
  const navigate = useNavigate();
  return (
    <div className="shell">
      <header className="topbar">
        <strong>StockFlow WMS</strong>
        <nav>
          <NavLink to="/">Dashboard</NavLink>
          <NavLink to="/products">Products</NavLink>
          <NavLink to="/inventory">Inventory</NavLink>
          <NavLink to="/orders">Orders</NavLink>
        </nav>
        <span className="spacer" />
        <span className="muted">
          {user?.name} ({user?.role})
        </span>
        <button
          className="ghost"
          onClick={() => {
            clearSession();
            navigate("/login");
          }}
        >
          Sign out
        </button>
      </header>
      <main>{children}</main>
    </div>
  );
}

export default function App() {
  const authed = !!getToken();
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      {authed ? (
        <Route
          path="/*"
          element={
            <Layout>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/products" element={<Products />} />
                <Route path="/inventory" element={<Inventory />} />
                <Route path="/orders" element={<Orders />} />
                <Route path="/orders/:id" element={<OrderDetail />} />
              </Routes>
            </Layout>
          }
        />
      ) : (
        <Route path="*" element={<Navigate to="/login" replace />} />
      )}
    </Routes>
  );
}
