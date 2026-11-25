package dev.ga16.litweb.client.shaders;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.jspecify.annotations.Nullable;

/**
 * The subset of the C preprocessor that shader packs rely on before the GLSL compiler sees the code:
 * conditionals, #define/#undef and macro expansion inside #if. Unlike glslang's preprocessor it keeps
 * comments, because packs put directives like RENDERTARGETS and buffer formats in them.
 */
public final class Cpp {
	/** One source line and where it came from, for error messages. */
	public record Line(String text, String file, int line) {}

	record Macro(@Nullable List<String> params, String body) {}

	final Map<String, Macro> macros = new HashMap<>();
	/** GLSL keeps #version, #extension and friends; .properties files treat unknown directives as comments. */
	private final boolean glsl;

	public Cpp(Map<String, String> defines, boolean glsl) {
		this.glsl = glsl;
		defines.forEach((k, v) -> macros.put(k, new Macro(null, v)));
	}

	/** The value of a macro after this preprocessor ran, or null. */
	public @Nullable String value(String name) {
		Macro m = macros.get(name);
		return m == null ? null : expand(m.body, 0, new HashSet<>(Set.of(name)));
	}

	public List<Line> run(List<Line> in) {
		List<Line> joined = joinContinuations(in);
		List<Line> out = new ArrayList<>(joined.size());
		// Each frame: {active, taken}. active = this branch is emitted; taken = some branch of this #if was true.
		Deque<boolean[]> stack = new ArrayDeque<>();
		boolean inComment = false;
		for (Line l : joined) {
			String t = l.text.strip();
			boolean directive = !inComment && t.startsWith("#");
			inComment = commentStateAfter(l.text, inComment);
			boolean active = stack.isEmpty() || stack.peek()[0];
			if (!directive) {
				if (active) out.add(l);
				continue;
			}
			String body = stripComments(t.substring(1)).strip();
			String name = word(body);
			String rest = body.substring(name.length()).strip();
			switch (name) {
				case "if" -> push(stack, active, active && eval(rest));
				case "ifdef" -> push(stack, active, active && macros.containsKey(word(rest)));
				case "ifndef" -> push(stack, active, active && !macros.containsKey(word(rest)));
				case "elif" -> {
					boolean[] f = top(stack);
					boolean parent = parentActive(stack);
					if (f[1]) f[0] = false;
					else if (parent && eval(rest)) f[0] = f[1] = true;
					else f[0] = false;
				}
				case "else" -> {
					boolean[] f = top(stack);
					f[0] = parentActive(stack) && !f[1];
					f[1] = true;
				}
				case "endif" -> {
					if (!stack.isEmpty()) stack.pop();
				}
				default -> {
					if (!active) continue;
					if (name.equals("define")) define(rest);
					else if (name.equals("undef")) macros.remove(word(rest));
					if (glsl || name.equals("define") || name.equals("undef")) out.add(l);
				}
			}
		}
		return out;
	}

	private static void push(Deque<boolean[]> stack, boolean parent, boolean value) {
		stack.push(new boolean[] {value, value || !parent});
	}

	private static boolean[] top(Deque<boolean[]> stack) {
		if (stack.isEmpty()) stack.push(new boolean[] {false, true}); // stray #else/#elif: ignore its branch
		return stack.peek();
	}

	private static boolean parentActive(Deque<boolean[]> stack) {
		boolean first = true;
		for (boolean[] f : stack) {
			if (first) {
				first = false;
				continue;
			}
			return f[0];
		}
		return true;
	}

	private void define(String rest) {
		String name = word(rest);
		if (name.isEmpty()) return;
		String after = rest.substring(name.length());
		if (after.startsWith("(")) {
			int close = after.indexOf(')');
			if (close < 0) return;
			List<String> params = new ArrayList<>();
			for (String p : after.substring(1, close).split(",")) if (!p.isBlank()) params.add(p.strip());
			macros.put(name, new Macro(params, after.substring(close + 1).strip()));
		} else {
			macros.put(name, new Macro(null, after.strip()));
		}
	}

	static List<Line> joinContinuations(List<Line> in) {
		List<Line> out = new ArrayList<>(in.size());
		StringBuilder acc = null;
		Line first = null;
		for (Line l : in) {
			String t = l.text;
			boolean cont = t.endsWith("\\");
			if (acc == null) {
				if (!cont) {
					out.add(l);
					continue;
				}
				acc = new StringBuilder();
				first = l;
			}
			acc.append(cont ? t.substring(0, t.length() - 1) : t);
			if (!cont) {
				out.add(new Line(acc.toString(), first.file, first.line));
				acc = null;
			}
		}
		if (acc != null) out.add(new Line(acc.toString(), first.file, first.line));
		return out;
	}

	/** Whether a block comment is still open at the end of this line. */
	static boolean commentStateAfter(String s, boolean in) {
		for (int i = 0; i < s.length() - 1; i++) {
			char c = s.charAt(i), n = s.charAt(i + 1);
			if (in) {
				if (c == '*' && n == '/') {
					in = false;
					i++;
				}
			} else if (c == '/' && n == '/') {
				return false;
			} else if (c == '/' && n == '*') {
				in = true;
				i++;
			}
		}
		return in;
	}

	static String stripComments(String s) {
		StringBuilder b = new StringBuilder(s.length());
		for (int i = 0; i < s.length(); i++) {
			if (s.startsWith("//", i)) break;
			if (s.startsWith("/*", i)) {
				int e = s.indexOf("*/", i + 2);
				if (e < 0) break;
				i = e + 1;
				b.append(' ');
				continue;
			}
			b.append(s.charAt(i));
		}
		return b.toString();
	}

	private static String word(String s) {
		int i = 0;
		while (i < s.length() && (Character.isLetterOrDigit(s.charAt(i)) || s.charAt(i) == '_')) i++;
		return s.substring(0, i);
	}

	// ---- #if expressions ----

	public boolean eval(String expr) {
		try {
			return new Expr(expand(resolveDefined(expr), 0, new HashSet<>())).parse() != 0;
		} catch (RuntimeException e) {
			return false; // malformed expression: treat as false, like a missing feature
		}
	}

	private String resolveDefined(String s) {
		StringBuilder b = new StringBuilder();
		int i = 0;
		while (i < s.length()) {
			if (s.startsWith("defined", i) && (i == 0 || !isIdent(s.charAt(i - 1))) && (i + 7 >= s.length() || !isIdent(s.charAt(i + 7)))) {
				int j = i + 7;
				while (j < s.length() && s.charAt(j) == ' ') j++;
				boolean paren = j < s.length() && s.charAt(j) == '(';
				if (paren) j++;
				while (j < s.length() && s.charAt(j) == ' ') j++;
				int k = j;
				while (k < s.length() && isIdent(s.charAt(k))) k++;
				b.append(macros.containsKey(s.substring(j, k)) ? " 1 " : " 0 ");
				if (paren) {
					while (k < s.length() && s.charAt(k) != ')') k++;
					k++;
				}
				i = k;
			} else {
				b.append(s.charAt(i++));
			}
		}
		return b.toString();
	}

	private String expand(String s, int depth, Set<String> busy) {
		if (depth > 32) return s;
		StringBuilder b = new StringBuilder();
		int i = 0;
		while (i < s.length()) {
			char c = s.charAt(i);
			if (!Character.isLetter(c) && c != '_') {
				if (Character.isDigit(c) || c == '.') { // keep numbers like 1e5 or 0x1F whole
					int j = i;
					while (j < s.length() && (isIdent(s.charAt(j)) || s.charAt(j) == '.')) j++;
					b.append(s, i, j);
					i = j;
				} else {
					b.append(c);
					i++;
				}
				continue;
			}
			int j = i;
			while (j < s.length() && isIdent(s.charAt(j))) j++;
			String id = s.substring(i, j);
			Macro m = busy.contains(id) ? null : macros.get(id);
			if (m == null) {
				b.append(id.equals("true") ? "1" : id.equals("false") ? "0" : " 0 ");
				i = j;
				continue;
			}
			if (m.params == null) {
				busy.add(id);
				b.append(' ').append(expand(m.body, depth + 1, busy)).append(' ');
				busy.remove(id);
				i = j;
				continue;
			}
			int k = j;
			while (k < s.length() && s.charAt(k) == ' ') k++;
			if (k >= s.length() || s.charAt(k) != '(') {
				b.append(" 0 ");
				i = j;
				continue;
			}
			List<String> args = new ArrayList<>();
			int level = 0, start = k + 1;
			for (k = k + 1; k < s.length(); k++) {
				char ch = s.charAt(k);
				if (ch == '(') level++;
				else if (ch == ')') {
					if (level-- == 0) break;
				} else if (ch == ',' && level == 0) {
					args.add(s.substring(start, k));
					start = k + 1;
				}
			}
			if (k <= s.length() && start <= k && k <= s.length()) args.add(s.substring(start, Math.min(k, s.length())));
			String body = m.body;
			for (int p = 0; p < m.params.size(); p++) body = body.replaceAll("\\b" + java.util.regex.Pattern.quote(m.params.get(p)) + "\\b", java.util.regex.Matcher.quoteReplacement(p < args.size() ? args.get(p).strip() : ""));
			busy.add(id);
			b.append(' ').append(expand(body, depth + 1, busy)).append(' ');
			busy.remove(id);
			i = Math.min(k + 1, s.length());
		}
		return b.toString();
	}

	private static boolean isIdent(char c) {
		return Character.isLetterOrDigit(c) || c == '_';
	}

	/** Recursive-descent evaluator over doubles, so float comparisons in packs work too. */
	private static final class Expr {
		private final String s;
		private int i;

		Expr(String s) {
			this.s = s;
		}

		double parse() {
			double v = ternary();
			skip();
			if (i != s.length()) throw new IllegalArgumentException("trailing input");
			return v;
		}

		private void skip() {
			while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++;
		}

		private boolean eat(String op) {
			skip();
			if (s.startsWith(op, i)) {
				// don't split "<<" into "<" or "&&" into "&"
				if ((op.equals("<") || op.equals(">")) && i + 1 < s.length() && (s.charAt(i + 1) == op.charAt(0) || s.charAt(i + 1) == '=')) return false;
				if ((op.equals("&") || op.equals("|")) && i + 1 < s.length() && s.charAt(i + 1) == op.charAt(0)) return false;
				if (op.equals("!") && i + 1 < s.length() && s.charAt(i + 1) == '=') return false;
				i += op.length();
				return true;
			}
			return false;
		}

		private double ternary() {
			double c = or();
			if (eat("?")) {
				double a = ternary();
				if (!eat(":")) throw new IllegalArgumentException("expected :");
				double b = ternary();
				return c != 0 ? a : b;
			}
			return c;
		}

		private double or() {
			double v = and();
			while (eat("||")) {
				double r = and();
				v = v != 0 || r != 0 ? 1 : 0;
			}
			return v;
		}

		private double and() {
			double v = bitOr();
			while (eat("&&")) {
				double r = bitOr();
				v = v != 0 && r != 0 ? 1 : 0;
			}
			return v;
		}

		private double bitOr() {
			double v = bitXor();
			while (eat("|")) v = (long) v | (long) bitXor();
			return v;
		}

		private double bitXor() {
			double v = bitAnd();
			while (eat("^")) v = (long) v ^ (long) bitAnd();
			return v;
		}

		private double bitAnd() {
			double v = equality();
			while (eat("&")) v = (long) v & (long) equality();
			return v;
		}

		private double equality() {
			double v = relational();
			while (true) {
				if (eat("==")) v = v == relational() ? 1 : 0;
				else if (eat("!=")) v = v != relational() ? 1 : 0;
				else return v;
			}
		}

		private double relational() {
			double v = shift();
			while (true) {
				if (eat("<=")) v = v <= shift() ? 1 : 0;
				else if (eat(">=")) v = v >= shift() ? 1 : 0;
				else if (eat("<")) v = v < shift() ? 1 : 0;
				else if (eat(">")) v = v > shift() ? 1 : 0;
				else return v;
			}
		}

		private double shift() {
			double v = additive();
			while (true) {
				if (eat("<<")) v = (long) v << (long) additive();
				else if (eat(">>")) v = (long) v >> (long) additive();
				else return v;
			}
		}

		private double additive() {
			double v = mult();
			while (true) {
				if (eat("+")) v += mult();
				else if (eat("-")) v -= mult();
				else return v;
			}
		}

		private double mult() {
			double v = unary();
			while (true) {
				if (eat("*")) v *= unary();
				else if (eat("/")) {
					double d = unary();
					v = d == 0 ? 0 : v / d;
				} else if (eat("%")) {
					double d = unary();
					v = d == 0 ? 0 : v % d;
				} else return v;
			}
		}

		private double unary() {
			if (eat("!")) return unary() == 0 ? 1 : 0;
			if (eat("-")) return -unary();
			if (eat("+")) return unary();
			if (eat("~")) return ~(long) unary();
			if (eat("(")) {
				double v = ternary();
				if (!eat(")")) throw new IllegalArgumentException("expected )");
				return v;
			}
			skip();
			int j = i;
			while (j < s.length() && (Character.isLetterOrDigit(s.charAt(j)) || s.charAt(j) == '.')) j++;
			if (j == i) throw new IllegalArgumentException("expected a number");
			String num = s.substring(i, j).toLowerCase();
			i = j;
			if (num.startsWith("0x")) return Long.parseLong(num.substring(2).replaceAll("[ul]+$", ""), 16);
			return Double.parseDouble(num.replaceAll("(?<=\\d)[ulf]+$", ""));
		}
	}
}
