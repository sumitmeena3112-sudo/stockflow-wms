import { Navigate, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { clearSession, getToken, getUser } from "./api";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Warehouse from "./pages/Warehouse";
import Products from "./pages/Products";
import Inventory from "./pages/Inventory";
import Orders from "./pages/Orders";
import OrderDetail from "./pages/OrderDetail";
import Label from "./pages/Label";
import Deliveries from "./pages/Deliveries";
import Issues from "./pages/Issues";

function Layout({ children }: { children: React.ReactNode }) {
  const user = getUser();
  const navigate = useNavigate();
  return (
    <div className="shell">
      <header className="topbar">
        <strong>StockFlow</strong>
        <nav>
          {/* Warehouse staff get a short menu; office management pages are admin-only */}
          {user?.role === "ADMIN" && <NavLink to="/" end>Dashboard</NavLink>}
          <NavLink to="/warehouse">Warehouse</NavLink>
          <NavLink to="/orders">Orders</NavLink>
          <NavLink to="/deliveries">Deliveries</NavLink>
          {user?.role === "ADMIN" && <NavLink to="/inventory">Inventory</NavLink>}
          {user?.role === "ADMIN" && <NavLink to="/products">Products</NavLink>}
          <NavLink to="/issues">Issues</NavLink>
        </nav>
        <span className="spacer" />
        <span className="muted small">{user?.name}</span>
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
  const isPicker = getUser()?.role === "PICKER";
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      {authed ? (
        <Route
          path="/*"
          element={
            <Layout>
              <Routes>
                <Route path="/" element={isPicker ? <Navigate to="/warehouse" replace /> : <Dashboard />} />
                <Route path="/warehouse" element={<Warehouse />} />
                <Route path="/products" element={isPicker ? <Navigate to="/warehouse" replace /> : <Products />} />
                <Route path="/inventory" element={isPicker ? <Navigate to="/warehouse" replace /> : <Inventory />} />
                <Route path="/orders" element={<Orders />} />
                <Route path="/orders/:id" element={<OrderDetail />} />
                <Route path="/orders/:id/label" element={<Label />} />
                <Route path="/deliveries" element={<Deliveries />} />
                <Route path="/issues" element={<Issues />} />
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
